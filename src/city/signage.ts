import type { PropCanvas } from "./prop-canvas.ts";
import { randomFor, type Building, type CityWorld, type RGB } from "./world.ts";
import { groundFloorPlace } from "./building-interiors.ts";
import { isGroundFloorKind, type GroundFloorKind } from "./interiors.ts";
import { cuboid, ink, propAlpha, propRange, restorePropRange } from "./activity.ts";
import { LINE_PER_METRE } from "./landmarks-scene.ts";
import { DISTRICT_SIGNS, INSERT_SIGNS } from "./messages.ts";
import { LINES, lineDistance, linePose } from "./metro.ts";
import { hackLook, hackSiteOn, shopDoorWidth, type HackSite } from "../rpg/hacking/sites.ts"; // Hacking: ATMs and service-door keypads


/** Sign formats the shader draws (materials.ts sign section, u_signStyle). */
export const SIGN_FORMAT = { classic: 0, boxed: 1, backlit: 2, led: 3, insert: 4 } as const;
export type SignFormat = (typeof SIGN_FORMAT)[keyof typeof SIGN_FORMAT];
/** u_signStyle: the format plus 8 x the district look (0 neutral, district id + 1). */
export const signStyle = (format: SignFormat, district?: number): number => format + 8 * (district === undefined ? 0 : district + 1);

/** fascia: the street-face name sign (always faces 0 and 1: engine.ts lights shops and hangs
 * holograms and screens from them); blade / corner: stacked vertical letters (projecting from the
 * face, or from a tower corner); ticker: an LED strip under the fascia running the message feed;
 * insert: a small OPEN / 24H sign in a shop window. */
export type SignKind = "fascia" | "blade" | "corner" | "ticker" | "insert";

/** `seed` (optional) fixes the sign's behaviour (the shader's mode is floor(seed * 97) mod 4: 0 steady
 * tube with rare dips, 1 marquee, 2 power-up sweep, 3 slow pulse); by default it hashes the position.
 * `style` is signStyle(format, district) (default classic, neutral); `columns` the letters across an
 * LED ticker (its text comes from the message feed). */
export interface SignFace { x: number; y: number; z: number; yaw: number; width: number; height: number; text: string; color: RGB; vertical?: boolean; seed?: number; kind?: SignKind; style?: number; columns?: number }

/** Sign colours by district (The Foundry, Neon Ward, Ghost Circuit, Rain Gardens, Silk Market, The
 * Spillway); null keeps the building's accent. */
const DISTRICT_INKS: readonly (readonly RGB[] | null)[] = [
  [[255, 150, 44], [255, 118, 40], [255, 186, 72]],
  [[255, 58, 170], [64, 230, 255], [255, 84, 196], [96, 240, 255]],
  [[104, 146, 255], [150, 188, 255], [84, 170, 255]],
  null,
  [[255, 188, 92], [255, 84, 64], [255, 212, 120], [255, 140, 70]],
  [[255, 222, 64], [250, 200, 40], [255, 236, 120]],
];
/** Fascia format odds by district: [boxed, back-lit] (the rest classic). */
const FORMAT_ODDS: readonly (readonly [number, number])[] = [[0, 0.3], [0.2, 0], [0, 0.2], [0.35, 0], [0.45, 0.1], [0.1, 0.55]];
const INSERT_INKS: readonly RGB[] = [[255, 64, 84], [96, 255, 150], [80, 220, 255], [255, 200, 90]];
const INKS_WARM: readonly RGB[] = [[255, 96, 64], [255, 196, 96], [255, 150, 60]];
/** Draw ranges (m): window inserts and LED tickers are small, so they stop well before the fascias. */
export const INSERT_REACH = 90, TICKER_REACH = 170;
/** Blade signs: the lowest letter's base (m, clear of awnings) and the most height a blade may take. */
const BLADE_BASE = 6, BLADE_SPAN = 16;

const wrap64 = (v: number) => ((v % 64) + 64) % 64;
const smoothstep = (a: number, b: number, v: number): number => { const k = Math.min(1, Math.max(0, (v - a) / (b - a))); return k * k * (3 - 2 * k); };
/** How long an ATM shows "paid" (rpg/session.ts setHackLook(..., "paid", 10)). */
const ATM_PAID_SECONDS = 10;
const pick = <T>(list: readonly T[], r: number): T => list[Math.min(list.length - 1, Math.floor(r * list.length))];

const faceCache = new WeakMap<Building, SignFace[]>();
/** A building's sign faces (fixed by its shape, so built once and cached: vfx-scene asks every frame). */
export function signFaces(building: Building): SignFace[] {
  let faces = faceCache.get(building);
  if (!faces) { faces = buildSignFaces(building); faceCache.set(building, faces); }
  return faces;
}
function buildSignFaces(building: Building): SignFace[] {
  const { x, z, width, depth, sign, accent, id, district, height: towerHeight } = building;
  const sx = wrap64(x) < 32 ? -1 : 1, sz = wrap64(z) < 32 ? -1 : 1;
  const r = (k: number) => randomFor(id, 913, k);
  const inks = DISTRICT_INKS[district] ?? null;
  const color: RGB = inks ? pick(inks, r(1)) : accent;
  const [boxed, backlit] = FORMAT_ODDS[district] ?? [0, 0];
  const roll = r(2), format: SignFormat = roll < boxed ? SIGN_FORMAT.boxed : roll < boxed + backlit ? SIGN_FORMAT.backlit : SIGN_FORMAT.classic;
  const style = signStyle(format, district);
  // About a third of the shops that light a fascia (id % 3 === 0, see drawShop) carry an LED ticker
  // under it, so the fascia sits a little higher (5.6-8.5 m; the ticker at 4.75-5.45 m).
  const ticker = id % 3 === 0 && r(3) < (district === 1 ? 0.5 : 0.3);
  const fy = ticker ? 7.05 : 6.4, fh = ticker ? 2.9 : 4.2;
  const faces: SignFace[] = [
    { x, y: fy, z: z + sz * (depth / 2 + 0.28), yaw: sz > 0 ? 0 : 180, width: width - 1, height: fh, text: sign, color, kind: "fascia", style },
    { x: x + sx * (width / 2 + 0.28), y: fy, z, yaw: sx * 90, width: depth - 1, height: fh, text: sign, color, kind: "fascia", style },
  ];
  if (ticker) {
    const led: RGB = district === 1 ? [255, 70, 120] : r(4) < 0.5 ? [255, 150, 40] : [255, 64, 44];
    const strip = (fx: number, fz: number, yaw: number, span: number) => faces.push({ x: fx, y: 5.1, z: fz, yaw, width: span * 0.8, height: 0.7, text: "LED", color: led, kind: "ticker", style: signStyle(SIGN_FORMAT.led, district), columns: Math.max(8, Math.min(40, Math.round(span * 0.8 * 0.94 / 0.33))) });
    strip(x, z + sz * (depth / 2 + 0.3), sz > 0 ? 0 : 180, width);
    strip(x + sx * (width / 2 + 0.3), z, sx * 90, depth);
  }
  // Projecting blade signs are rare off the avenue: a few bright ones read better than a wall of them.
  const blades = id % 7 === 0 || (Math.abs(x) < 30 && id % 2 === 0);
  if (blades) {
    const text = sign.split(" ")[0].slice(0, 7);
    // Fewer blade signs, but big enough to read from down the street. The whole word has to fit a
    // view from the street: at 3.8-4.8 m a letter a seven-letter blade ran 8 m to 36 m up, and from
    // anywhere nearer than ~57 m its upper letters were above the top of the screen ("ITO" of a
    // longer word). Capped at BLADE_SPAN from 6 m (clear of awnings and canopy struts, 5.8 m), a
    // blade tops out at 22 m: whole in a level view from ~33 m. Long words get smaller letters on a
    // narrower blade (the slot keeps roughly the letter's own aspect).
    const big = id % 4 === 0, letter = Math.min(big ? 4.8 : 3.8, (BLADE_SPAN - 1.5) / text.length);
    const height = text.length * letter + 1.5, bladeW = Math.min(big ? 6 : 4.8, Math.max(3, letter * 1.45));
    // Projecting blade signs face along the street; their placement is fixed. The inner edge keeps
    // its old gap from the wall (0.4 m big, 1 m otherwise), so a narrower blade still hangs close.
    const signX = x + sx * (width / 2 + (big ? 0.4 : 1) + bladeW / 2);
    for (const side of [-1, 1]) faces.push({ x: signX, y: BLADE_BASE + height / 2, z: z + side * 0.24, yaw: side > 0 ? 0 : 180, width: bladeW, height, text, color, vertical: true, kind: "blade", style: signStyle(SIGN_FORMAT.classic, district) });
  }
  // Tower-corner signs: stacked letters on a blade projecting diagonally from the street corner,
  // readable down both streets. Neon Ward hangs huge ones on a fifth of its towers; elsewhere a
  // few. Not on the avenue (the rail deck and service bridges), from 12 m up, under the roof.
  const cornerOdds = district === 1 ? 0.22 : district === 3 ? 0.03 : 0.06;
  if (!blades && Math.abs(x) >= 32 && towerHeight > 34 && r(5) < cornerOdds) {
    const text = pick(DISTRICT_SIGNS[district] ?? DISTRICT_SIGNS[1], r(6)).split(" ")[0].slice(0, 8);
    const letter = Math.min(district === 1 ? 5.6 : 4.2, (towerHeight - 16) / text.length);
    const bladeW = district === 1 ? 4.4 : 3.6;
    const dx = sx * Math.SQRT1_2, dz = sz * Math.SQRT1_2, out = 0.35 + bladeW / 2;
    const cx = x + sx * width / 2 + dx * out, cz = z + sz * depth / 2 + dz * out;
    // Clear of the elevated lines (decks at 28-41 m, right across the sign's height): no metro
    // track within 10 m of the blade's centre.
    const clear = LINES.every((_, line) => { const pose = linePose(line, lineDistance(line, cx, cz)); return Math.hypot(pose.x - cx, pose.z - cz) > 10; });
    if (letter >= 2.4 && clear) {
      const height = text.length * letter + 1.5;
      const yaw = Math.atan2(-dz, dx) * 180 / Math.PI;
      const ink: RGB = inks ? pick(inks, r(7)) : accent;
      for (const side of [-1, 1]) faces.push({ x: cx - dz * side * 0.24, y: 12 + height / 2, z: cz + dx * side * 0.24, yaw: yaw + (side > 0 ? 0 : 180), width: bladeW, height, text, color: ink, vertical: true, kind: "corner", style: signStyle(SIGN_FORMAT.classic, district) });
    }
  }
  // Window inserts on the shops without a fascia sign (their stalls keep the left window): OPEN,
  // 24H, CASH ONLY... in the right-hand window's top corner. Silk Market crowds both street faces.
  if (id % 3 !== 0 && r(8) < (district === 4 ? 1 : 0.45)) {
    for (const side of district === 4 ? [0, 1] as const : [r(9) < 0.5 ? 0 : 1] as const) {
      const text = pick(INSERT_SIGNS, r(10 + side));
      const w = side ? depth : width, halfW = w / 2, door = Math.min(2.4, Math.max(1.6, w * 0.13));
      const paneFrom = door / 2 + 0.55, pane = Math.max(0.6, halfW - 0.85 - paneFrom);
      const along = paneFrom + pane / 2, signW = Math.min(pane * 0.85, text.length * 0.3 + 0.5);
      if (signW < 1) continue;
      // Face frame: x along the wall, the normal (sin yaw, cos yaw) out of it.
      const yaw = side ? sx * 90 : sz > 0 ? 0 : 180, a = yaw * Math.PI / 180, front = (side ? width : depth) / 2 + 0.32;
      const fx = side ? x + sx * front : x + Math.cos(a) * along, fz = side ? z - Math.sin(a) * along : z + sz * front;
      faces.push({ x: fx, y: 3.3, z: fz, yaw, width: signW, height: 0.52, text, color: district === 4 ? pick(INKS_WARM, r(12 + side)) : pick(INSERT_INKS, r(12 + side)), kind: "insert", style: signStyle(SIGN_FORMAT.insert, district) });
    }
  }
  return faces;
}

/**
 * How many of the packed-letter uniforms (u_text0..3, four letters each) the sign shader can read
 * for a panel. materials.ts packedChar reads word k / 4 only for letters k < u_textLength (12 or
 * fewer letters never touch u_text3, and so on), and LED tickers (format 3) read the message feed
 * instead of packed letters. The boxed format's monogram reads letter 0, which is already covered.
 */
export function signTextWords(textLength: number, style: number): number {
  if (Math.round(style) % 8 === SIGN_FORMAT.led) return 0;
  return textLength <= 0 ? 0 : Math.min(4, Math.ceil(textLength / 4));
}

/**
 * The fraction of a shop sign's board (u_signSpan, materials.ts) its word needs at a fixed letter
 * pitch: 0.8 of the letter height (the 3x5 face's 4-column by 5-row aspect), never more than the
 * format's text region. The shader centres the word in that region, so letters are evenly spaced
 * and never stretched apart across a wide board. 0 keeps the old layout (the sign's whole text
 * region split evenly) for everything but horizontal fascias and window inserts.
 */
export function signTextSpan(face: SignFace, length: number, style: number): number {
  // Only the shop fascias and inserts, which declare their kind: faces without one (metro boards,
  // landmark labels, alley signs) lay their text out themselves and must not be repacked.
  if (face.vertical || (face.kind !== "fascia" && face.kind !== "insert") || length <= 0) return 0;
  const format = Math.round(style) % 8;
  if (format === SIGN_FORMAT.led) return 0;
  const region = format === SIGN_FORMAT.boxed ? 0.68 : 0.9;
  return Math.min(region, (length * 0.8 * 0.68 * face.height) / Math.max(face.width, 0.01));
}

const encoded = new Map<string, number[]>();
/** `gain` dims the sign's colour (the shader derives ink, glow and emission from it, so 0 leaves
 * dark glass); `scale` shrinks the panel about its centre. Both 1 by default (drawShop fades its
 * small signs out with them). */
export function drawLetterPanel(t: PropCanvas, face: SignFace, gain = 1, scale = 1): void {
  let codes = encoded.get(face.text);
  if (!codes) {
    // Up to 16 letters: the sign shader reads u_text3 (letters 12-15) only when u_textLength > 12.
    codes = [...face.text.toUpperCase().slice(0, 16).padEnd(16)].map(c => Math.max(0, " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".indexOf(c)));
    encoded.set(face.text, codes);
  }
  const pack = (offset: number) => codes[offset] + codes[offset + 1] * 64 + codes[offset + 2] * 4096 + codes[offset + 3] * 262144;
  const seed = face.seed ?? Math.abs(Math.sin(face.x * 12.9898 + face.z * 78.233 + face.y) * 43758.5453) % 1;
  const length = face.columns ?? Math.min(16, face.text.length), style = face.style ?? 0;
  const uniforms: Record<string, number> = { u_surface: 3, u_textLength: length, u_vertical: face.vertical ? 1 : 0, u_signSeed: seed, u_signStyle: style, u_signSpan: signTextSpan(face, length, style) };
  // Perf: textmode sends a changed number uniform on the next draw, so the packed-letter words the
  // shader cannot read for this panel are left out (they keep whatever value they had): see
  // signTextWords. Fewer GL uniform calls per panel, identical pixels.
  const words = signTextWords(length, style);
  if (words > 0) uniforms.u_text0 = pack(0);
  if (words > 1) uniforms.u_text1 = pack(4);
  if (words > 2) uniforms.u_text2 = pack(8);
  if (words > 3) uniforms.u_text3 = pack(12);
  t.setUniforms(uniforms);
  t.push(); t.translate(face.x, -face.y, face.z); t.rotateY(face.yaw);
  const [r, g, b] = face.color;
  if (gain < 1) t.charColor(r * gain, g * gain, b * gain); else t.charColor(r, g, b);
  t.cellColor(3, 8, 12, propAlpha()); t.rect(face.width * scale, face.height * scale); t.pop();
  t.setUniform("u_surface", 2);
}

/** Each building's ground-floor kind (null: a venue, a secret or no interior), memoised per building. */
const shopKinds = new WeakMap<Building, GroundFloorKind | null>();
// The first time a few hundred buildings come inside the shop range (spawn, a teleport, the
// train) each would run groundFloorPlace in the same frame. Lookups past DRESSING_REACH (where
// only the window light depends on the kind) are amortised: about SHOP_KIND_BUDGET per frame
// (a token bucket refilled with elapsed time, so the mirror pass shares the frame's tokens), the
// rest draw undressed until their turn - a few frames. Within DRESSING_REACH, where the dressing
// shows through the glass, a building resolves at once (only a handful are ever that close), so
// the dressing never appears late.
const SHOP_KIND_BUDGET = 24, DRESSING_REACH = 80, FRAME_SECONDS = 1 / 60;
let kindTokens = SHOP_KIND_BUDGET, kindClock = -1;
function shopKind(world: CityWorld, building: Building, distance: number): GroundFloorKind | null {
  const cached = shopKinds.get(building);
  if (cached !== undefined) return cached;
  if (distance >= DRESSING_REACH) {
    const now = (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
    if (kindClock >= 0) kindTokens = Math.min(SHOP_KIND_BUDGET, kindTokens + (now - kindClock) / FRAME_SECONDS * SHOP_KIND_BUDGET);
    kindClock = now;
    if (kindTokens < 1) return null;
    kindTokens -= 1;
  }
  const place = groundFloorPlace(world, building);
  const kind = place && isGroundFloorKind(place.kind) ? place.kind : null;
  shopKinds.set(building, kind);
  return kind;
}

/**
 * `world` (optional) lets the shop windows show what is inside (building-interiors.ts
 * groundFloorPlace): the glass takes the interior's light, and close up its dressing shows through.
 */
export function drawShop(t: PropCanvas, building: Building, distance: number, eye: { x: number; z: number }, visible: (x: number, y: number, z: number, radius?: number) => boolean, range = 300, world?: CityWorld): void {
  const { x, z, width, depth, id } = building;
  const faces = signFaces(building);
  const outer = propRange(range);
  // Street fascia signs (and their LED tickers) on about a third of buildings; the rest keep lit
  // shopfronts, and some of those a small insert in the window. Vertical signs everywhere.
  for (const face of faces) {
    const kind = face.kind ?? (face.vertical ? "blade" : "fascia");
    if ((kind === "fascia" || kind === "ticker") && id % 3 !== 0) continue;
    // Small signs end sooner, as a fade. Past legibility the shader already draws them as a lit
    // panel (whole-sign level of detail, materials.ts); that panel's light then dims smoothly
    // (62-86% of the reach: a colour gain, no screen-space dither - the ordered dissolve
    // screen-doored on these small lit panels) and the dark glass left over shrinks away over
    // the last stretch, a cell or two dropping out by geometry, fixed in the world. The reach
    // stays inside the outer range's own dissolve (from 76% of it).
    const reach = kind === "insert" ? INSERT_REACH : kind === "ticker" ? TICKER_REACH : 0;
    const end = reach > 0 ? Math.min(reach, range * 0.76) : 0;
    const away = end > 0 ? Math.hypot(eye.x - face.x, eye.z - face.z) : 0;
    if (end > 0 && away > end * 0.985) continue;
    const angle = face.yaw * Math.PI / 180;
    if ((eye.x - face.x) * Math.sin(angle) + (eye.z - face.z) * Math.cos(angle) > 0 && visible(face.x, face.y, face.z, face.width / 2)) {
      if (end > 0) drawLetterPanel(t, face, 1 - smoothstep(end * 0.62, end * 0.86, away), 1 - smoothstep(end * 0.86, end, away));
      else drawLetterPanel(t, face);
    }
  }
  if (distance > 240) { restorePropRange(outer); return; }
  propRange(240);
  const kind = world ? shopKind(world, building, distance) : null;
  const bx = ((x % 64) + 64) % 64, sx = bx < 32 ? -1 : 1;
  const bz = ((z % 64) + 64) % 64, sz = bz < 32 ? -1 : 1;
  // Shopfronts on both street faces: framed windows with lit interiors, a door, an awning or
  // canopy and the street furniture against the wall. Detail is tiered by distance.
  for (const side of [0, 1] as const) {
    // Corner awning pop: the awning juts ~3 m out of its face, so its end still shows past the corner
    // once the eye crosses the face's extended plane. Skip only when the building stands between (behind the plane and
    // within the face's span), and test sight at the awning's outer edge, not the face (the building
    // hides that from beside it): the whole edge from in front, the corner end from behind the plane.
    const half = side ? depth / 2 : width / 2, along = side ? eye.z - z : eye.x - x;
    const behind = side ? (eye.x - x) * sx < width / 2 : (eye.z - z) * sz < depth / 2;
    if (behind && Math.abs(along) < half) continue;
    const end = behind ? Math.sign(along) * half : 0, ox = side ? x + sx * (width / 2 + 3) : x + end, oz = side ? z + end : z + sz * (depth / 2 + 3);
    if (!visible(ox, 3, oz, behind ? 3.5 : half + 1)) continue;
    t.push(); t.translate(x, 0, z); t.rotateY(side ? sx * 90 : sz > 0 ? 0 : 180);
    drawShopfront(t, building, side, side ? depth : width, (side ? width : depth) / 2, distance, kind);
    t.pop();
  }
  restorePropRange(outer);
}

/** Free pavement (m) between a street face and the residents' walking line (people.ts
 * pavementPoint: 7.2 m from a street's centre line, 14 m on the avenue), less half a resident. */
export function pavementRoom(building: Building, side: 0 | 1): number {
  const wrap64 = (v: number) => ((v % 64) + 64) % 64;
  if (side) {
    const avenue = Math.abs(building.x) < 32, local = wrap64(building.x);
    return (avenue ? Math.abs(building.x) : Math.min(local, 64 - local)) - building.width / 2 - (avenue ? 14 : 7.2) - 0.5;
  }
  const local = wrap64(building.z);
  return Math.min(local, 64 - local) - building.depth / 2 - 7.2 - 0.5;
}

/** Goods on shop shelves and stall counters, and the paper lanterns. */
const GOODS: readonly RGB[] = [[255, 122, 92], [92, 212, 230], [250, 212, 120], [186, 126, 240], [124, 230, 150], [236, 236, 222], [255, 96, 160]];
const INTERIOR: readonly RGB[] = [[255, 196, 128], [150, 220, 255], [255, 168, 214], [196, 255, 210]];
/** Things standing against a shop wall. All stay within PLAYER_RADIUS (0.8 m) of the face, inside
 * the building's collision skin, so nobody can walk into them and none reach the walking line. */
type WallThing = "vending" | "bags" | "crates" | "planter" | "kiosk" | "bike";
const WALL_THINGS: readonly (readonly WallThing[])[] = [
  ["crates", "vending", "bags", "kiosk"], // The Foundry
  ["vending", "kiosk", "vending", "bags"], // Neon Ward
  ["kiosk", "bags", "crates", "vending"], // Ghost Circuit
  ["planter", "bike", "planter", "vending"], // Rain Gardens
  ["crates", "vending", "planter", "bike"], // Silk Market
  ["bags", "crates", "bike", "bags"], // The Spillway
];

/**
 * One street face, in the face's frame: x along the wall, y up, +z out of the wall from `front`
 * (the face plane). Everything below head height stays within 0.8 m of the face (the collision
 * skin); awnings, lanterns and canopies are above 3.4 m. `w` is the face's width.
 */
function drawShopfront(t: PropCanvas, building: Building, side: 0 | 1, w: number, front: number, distance: number, kind: GroundFloorKind | null): void {
  const { id, accent, district } = building;
  const r = (k: number) => randomFor(id, side * 31 + 7, k);
  // Detail tiers, prefiltered by cell footprint (about distance x LINE_PER_METRE metres per cell): small
  // parts appear only close up; lines that stay (neon, light edges) are widened to about a cell.
  const near = distance < 30, close = distance < 80, mid = distance < 140, stall = id % 3 === 0;
  const line = distance * LINE_PER_METRE, glowLine = (cap: number) => Math.min(cap, Math.max(0.08, line));
  // The window light is the interior's own (every tier), so a street reads trade by trade from afar.
  const interior = kind ? KIND_LIGHT[kind] : INTERIOR[Math.floor(r(1) * INTERIOR.length)];
  const door = Math.min(2.4, Math.max(1.6, w * 0.13)), halfW = w / 2;
  const paneFrom = door / 2 + 0.55, paneTo = halfW - 0.85, pane = Math.max(0.6, paneTo - paneFrom);
  // Recess, pilasters and fascia: the frame the shopfront sits in (below the fascia sign, 4.3-8.5 m).
  ink(t, [13, 27, 34], "="); cuboid(t, 0, 2.5, front + 0.06, w - 1, 4.4, 0.12);
  ink(t, [32, 40, 46], "#");
  for (const s of [-1, 1]) cuboid(t, s * (halfW - 0.3), 2.35, front + 0.22, 0.6, 4.7, 0.44);
  ink(t, [28, 36, 42], "="); cuboid(t, 0, 4.45, front + 0.22, w, 0.5, 0.44);
  // Lit interiors behind the glass (low ink contrast; the frames carry the structure).
  ink(t, interior, ":", 0.58);
  for (const s of [-1, 1]) cuboid(t, s * (paneFrom + pane / 2), 2.4, front + 0.14, pane, 2.5, 0.05);
  ink(t, interior, "|", 0.42); cuboid(t, 0, 1.75, front + 0.14, door - 0.3, 3.1, 0.05);
  // A neon tube under the fascia: the light the shopfront's glow comes from.
  ink(t, accent, "-", 1.15); cuboid(t, 0, 3.98, front + 0.48, w * 0.86, glowLine(1.9), glowLine(1.9));
  if (near) {
    // Window frames and mullions, the door frame and its little lit plate.
    const bar = Math.max(0.12, line);
    ink(t, [46, 58, 64], "|");
    for (const s of [-1, 1]) {
      const centre = s * (paneFrom + pane / 2), bars = Math.max(1, Math.round(pane / 1.4));
      for (let k = 0; k <= bars; k++) cuboid(t, centre - pane / 2 + (pane * k) / bars, 2.4, front + 0.19, bar, 2.65, 0.08);
      ink(t, [52, 64, 70], "=");
      cuboid(t, centre, 1.08, front + 0.24, pane + 0.25, 0.16, 0.3);
      cuboid(t, centre, 3.0, front + 0.19, pane, 0.08, 0.07);
      cuboid(t, centre, 3.7, front + 0.2, pane + 0.2, 0.14, 0.12);
      ink(t, [46, 58, 64], "|");
    }
    for (const s of [-1, 1]) cuboid(t, s * door / 2, 1.75, front + 0.19, bar, 3.3, 0.1);
    cuboid(t, 0, 3.4, front + 0.19, door, 0.14, 0.1);
    ink(t, accent, "=", 1.05); cuboid(t, 0, 3.78, front + 0.24, door * 0.8, 0.3, 0.05);
  }
  if (kind && close) {
    // What is inside, seen through the glass (the stall's counter takes the left window instead).
    for (const s of [-1, 1]) {
      if (stall && s < 0) continue;
      drawWindowDressing(t, kind, s * (paneFrom + pane / 2), pane, front, near, line, accent, (k: number) => r(60 + k + (s > 0 ? 20 : 0)));
    }
  } else if (near) {
    // Shelves of goods in the windows (the stall's counter takes the left window instead).
    for (const s of [-1, 1]) {
      if (stall && s < 0) continue;
      const centre = s * (paneFrom + pane / 2), count = Math.max(2, Math.floor(pane / 0.65));
      for (const shelf of [1.55, 2.45]) {
        ink(t, [70, 78, 82], "="); cuboid(t, centre, shelf, front + 0.2, pane * 0.92, 0.05, 0.22);
        for (let k = 0; k < count; k++) {
          const g = r(10 + k + shelf * 7), h = 0.18 + g * 0.3, along = centre - pane * 0.42 + (pane * 0.84 * (k + 0.5)) / count;
          ink(t, GOODS[Math.floor(g * 97) % GOODS.length], g > 0.5 ? "#" : "=", 0.72);
          cuboid(t, along, shelf + 0.025 + h / 2, front + 0.21, Math.min(0.42, pane * 0.84 / count - 0.08), h, 0.16);
        }
      }
    }
  }
  // Overhead: awning, canopy or lantern line, by building and district.
  const awning = district === 4 && id % 2 === 0 ? 3 : Math.floor(r(2) * 3);
  if (awning === 0) {
    // A striped fabric awning sloping down from the fascia; scalloped valance close up.
    const reach = 3.0, slope = 11, stripes = distance < 70 ? Math.max(4, Math.round(w / 1.15)) : 1;
    for (let k = 0; k < stripes; k++) {
      const span = w / stripes, cx = -halfW + span * (k + 0.5);
      if (stripes === 1) ink(t, accent, "|", 0.5); else ink(t, k % 2 ? [214, 208, 190] : accent, k % 2 ? "=" : "|", k % 2 ? 0.42 : 0.55);
      t.push(); t.translate(cx, -4.3, front + 0.45); t.rotateX(-slope); t.translate(0, 0, reach / 2); t.box(span * 0.995, 0.1, reach); t.pop();
    }
    const edge = front + 0.45 + reach * Math.cos(slope * Math.PI / 180), lip = 4.3 - reach * Math.sin(slope * Math.PI / 180);
    if (near) for (let k = 0; k < stripes; k++) {
      const span = w / stripes;
      ink(t, k % 2 ? [214, 208, 190] : accent, "v", k % 2 ? 0.42 : 0.55);
      cuboid(t, -halfW + span * (k + 0.5), lip - 0.2, edge, span * 0.8, 0.32, 0.05);
    }
    ink(t, [248, 206, 137], "-", 0.85); cuboid(t, 0, lip - 0.06, edge - 0.15, w * 0.88, glowLine(1.3), glowLine(1.3));
    if (near) { ink(t, [60, 66, 70], "/"); for (const s of [-1, 1]) strutLocal(t, s * (halfW - 0.4), 3.3, front + 0.4, s * (halfW - 0.4), lip, edge - 0.1, 0.07); }
  } else if (awning === 1) {
    // A flat steel canopy on tie rods, lit from beneath.
    ink(t, [54, 62, 68], "="); cuboid(t, 0, 4.15, front + 1.55, w, 0.16, 2.6);
    ink(t, [248, 214, 160], "-", 1.05); cuboid(t, 0, 4.03, front + 2.75, w * 0.9, glowLine(1.9), glowLine(1.9));
    if (near) {
      ink(t, [74, 82, 88], "/");
      for (const s of [-0.35, 0.35]) strutLocal(t, s * w, 5.8, front + 0.2, s * w, 4.2, front + 2.8, 0.06);
      ink(t, [255, 236, 200], "o", 1.1);
      for (const s of [-0.3, -0.1, 0.1, 0.3]) cuboid(t, s * w, 4.03, front + 1.6, 0.25, 0.05, 0.25);
    }
  } else if (awning === 2) {
    // A short glass canopy with a light along its edge.
    ink(t, [104, 158, 176], "/", 0.42); cuboid(t, 0, 4.05, front + 1.05, w * 0.8, 0.06, 1.6);
    ink(t, accent, "-", 1.05); cuboid(t, 0, 4.0, front + 1.85, w * 0.8, glowLine(1.9), glowLine(1.9));
  }
  if (awning === 3 && !mid) {
    // Far off, a lantern line is a warm line along the fascia (single lanterns would blink in and out).
    ink(t, [255, 140, 80], "o", 0.9); cuboid(t, 0, 3.8, front + 0.9, w * 0.86, glowLine(1.5), glowLine(1.5));
  } else if (awning === 3 || (stall && close)) {
    // Paper lanterns on a line along the fascia, swaying in no wind (static: no motion to watch).
    const count = Math.max(3, Math.floor(w / 1.8)), out = awning === 3 ? 0.9 : awning === 0 ? 2.7 : awning === 1 ? 2.6 : 1.6;
    // Lantern bottoms stay above 3.1 m, clear of a walking eye (2.7 m).
    const hang = awning === 3 ? 4.2 : awning === 0 ? 3.85 : 4.0;
    if (awning === 3 && near) { ink(t, [40, 36, 34], "-"); cuboid(t, 0, hang + 0.02, front + out, w * 0.92, 0.04, 0.04); }
    for (let k = 0; k < count; k++) {
      const along = -halfW * 0.86 + (w * 0.86 * (k + 0.5)) / count;
      if (near) { ink(t, [60, 50, 40], "|"); cuboid(t, along, hang - 0.08, front + out, 0.03, 0.16, 0.03); }
      ink(t, k % 3 === 1 ? [255, 196, 96] : [255, 86, 64], "o", 1.0);
      const radius = Math.min(awning === 3 ? 0.7 : 0.4, Math.max(0.24, line * 0.5));
      ellipsoidLocal(t, along, hang - 0.45, front + out, radius, Math.max(0.3, radius), radius);
    }
  }
  if (!close) return;
  // Air conditioners high on the wall (above the fascia sign, which spans 4.3-8.5 m), dripping pipes.
  for (const s of [-1, 1]) {
    if (r(3 + s) < 0.35) continue;
    const ax = s * w * (0.22 + r(5 + s) * 0.18), ay = 9.4 + Math.floor(r(6 + s) * 3) * 3;
    ink(t, [92, 100, 104], "#"); cuboid(t, ax, ay, front + 0.4, 1.3, 0.85, 0.8);
    ink(t, [40, 46, 50], "@"); cuboid(t, ax + 0.18, ay, front + 0.81, 0.6, 0.6, 0.04);
    if (near) { ink(t, [70, 76, 80], "|"); cuboid(t, ax - 0.5, ay - 1.2, front + 0.3, 0.05, 1.6, 0.05); }
  }
  // Against the wall, either side of the windows: district street furniture.
  const things = WALL_THINGS[district] ?? WALL_THINGS[1];
  const hack = hackSiteOn(id), hackHere = hack && hack.side === side ? hack : null; // Hacking: an ATM takes the right-hand slot
  for (const s of [-1, 1]) {
    const pick = r(20 + s);
    if (pick < 0.3 || (stall && s < 0) || (s > 0 && hackHere?.kind === "atm")) continue;
    drawWallThing(t, things[Math.floor(pick * 13) % things.length], s * (halfW - 1.35), front, r(24 + s), near);
  }
  if (hackHere) drawHackSite(t, hackHere, front, w, near);
  if (stall) {
    // A street-food counter against the left window: counter, top, menu light, bowls and a pot.
    const cx = -(paneFrom + pane / 2), cw = Math.min(pane + 0.4, 4.4);
    ink(t, [124, 76, 50], "#", 0.9); cuboid(t, cx, 0.55, front + 0.42, cw, 1.1, 0.7);
    ink(t, [196, 160, 120], "=", 0.8); cuboid(t, cx, 1.14, front + 0.43, cw + 0.12, 0.08, 0.72);
    if (distance < 60) { ink(t, [255, 214, 140], "=", 1.05); cuboid(t, cx, 2.95, front + 0.17, cw * 0.8, 0.6, 0.04); }
    if (near) {
      ink(t, [210, 214, 206], "o", 0.8);
      for (let k = 0; k < 3; k++) ellipsoidLocal(t, cx - cw * 0.3 + k * cw * 0.2, 1.24, front + 0.5, 0.15, 0.08, 0.15);
      ink(t, [130, 136, 140], "#"); cuboid(t, cx + cw * 0.32, 1.38, front + 0.42, 0.42, 0.4, 0.42);
      // Stools only where the pavement is wide: small (0.34 m) clutter, never a wall to walk into.
      if (pavementRoom(building, side) > 1.8) for (let k = 0; k < 3; k++) {
        const seat = cx - cw * 0.3 + k * cw * 0.3;
        ink(t, [60, 62, 66], "|"); cuboid(t, seat, 0.32, front + 1.2, 0.06, 0.64, 0.06);
        ink(t, [150, 60, 54], "o"); cuboid(t, seat, 0.68, front + 1.2, 0.34, 0.08, 0.34);
      }
    }
  }
  if (district === 0) {
    // The Foundry: a service pipe along the wall over the fascia, with a downpipe at one end.
    ink(t, [104, 86, 74], "="); cuboid(t, 0, 5.45, front + 0.32, w - 0.6, Math.min(2, Math.max(0.28, line)), 0.28);
    ink(t, [96, 80, 70], "|"); cuboid(t, (r(30) < 0.5 ? -1 : 1) * (halfW - 0.75), 2.7, front + 0.32, Math.min(1, Math.max(0.26, line)), 5.4, 0.26);
  } else if (district === 2) {
    // Ghost Circuit: sagging cable bundles across the wall.
    ink(t, [40, 50, 66], "~");
    for (let k = 0; k < 3; k++) for (const s of [-1, 1]) {
      const y = 5.5 + k * 0.28;
      strutLocal(t, 0, y - 0.35, front + 0.36, s * (halfW - 0.6), y, front + 0.36, Math.max(0.06, line));
    }
  } else if (district === 3 && near) {
    // Rain Gardens: moss hanging from the fascia.
    ink(t, [70, 150, 96], "|", 0.85);
    for (let k = 0; k < 9; k++) { const length = 0.35 + r(40 + k) * 0.8; cuboid(t, -halfW + 0.8 + (w - 1.6) * (k / 8), 4.6 - length / 2, front + 0.46, 0.1, length, 0.04); }
  } else if (district === 1 && near) {
    // Neon Ward: a small projecting neon blade beside the door (within the wall's skin).
    ink(t, id % 2 ? [255, 96, 196] : [96, 236, 255], "|", 1.15); cuboid(t, door / 2 + 0.35, 2.9, front + 0.5, 0.1, 1.5, 0.5);
  }
}

/** Window light per ground-floor kind (close to building-interiors.ts LIGHTS, the room's own light). */
const KIND_LIGHT: Readonly<Record<GroundFloorKind, RGB>> = {
  lobby: [255, 222, 176], "capsule-hotel": [150, 200, 255], "corp-lobby": [228, 238, 255], arcade: [255, 92, 200], pawnshop: [255, 204, 110],
  "machine-shop": [255, 168, 84], "server-hall": [92, 162, 255], shrine: [255, 146, 64], hydroponics: [240, 104, 232], laundromat: [218, 248, 255],
  "market-hall": [255, 190, 110], chandlery: [255, 210, 150], apartment: [255, 198, 148], garage: [255, 160, 76],
};
const ARCADE_SCREENS: readonly RGB[] = [[255, 80, 200], [80, 232, 255]];

/**
 * The interior's dressing seen through one shop window, in the face's frame: `cx` is the window's
 * centre, `pane` its width; the glass spans 1.15-3.65 m at front + 0.14. Silhouettes sit just in front
 * of the glass (faces at about front + 0.2, behind the mullions) and are static: no flicker, no motion.
 * Near (< 30 m) draws the parts; close (< 80 m) a couple of boxes per window, sized to at least a cell.
 */
function drawWindowDressing(t: PropCanvas, kind: GroundFloorKind, cx: number, pane: number, front: number, near: boolean, line: number, accent: RGB, r: (k: number) => number): void {
  const iw = pane * 0.86, z = front + 0.185, up = z + 0.014, D = 0.03;
  const th = (v: number) => Math.max(v, line);
  const slots = (spacing: number, most: number) => Math.max(1, Math.min(most, Math.floor(iw / spacing)));
  const at = (k: number, n: number) => cx - iw / 2 + (iw * (k + 0.5)) / n;
  switch (kind) {
    case "arcade": {
      // Cabinet rows: dark bodies with pink and cyan attract screens.
      if (!near) { for (const s of [-1, 1]) { ink(t, ARCADE_SCREENS[s < 0 ? 0 : 1], "=", 1.1); cuboid(t, cx + s * iw / 4, 2.25, z, iw / 2 - 0.1, th(0.4), D); } return; }
      const n = slots(0.9, 4);
      ink(t, [34, 26, 52], "#", 0.9);
      for (let k = 0; k < n; k++) cuboid(t, at(k, n), 1.95, z, 0.62, 1.6, D);
      for (let k = 0; k < n; k++) { ink(t, ARCADE_SCREENS[k % 2], "=", 1.15); cuboid(t, at(k, n), 2.3, up, 0.44, 0.36, D); }
      return;
    }
    case "laundromat": {
      // Cool white tubes over a row of washers with round portholes.
      ink(t, [236, 250, 255], "-", 1.15); cuboid(t, cx, 3.4, z, iw, th(0.08), D);
      if (!near) { ink(t, [196, 204, 210], "o", 0.85); cuboid(t, cx, 1.6, z, iw, 0.85, D); return; }
      const n = slots(0.85, 4);
      ink(t, [196, 204, 210], "#", 0.75);
      for (let k = 0; k < n; k++) cuboid(t, at(k, n), 1.6, z, 0.7, 0.85, D);
      ink(t, [70, 122, 150], "O", 1.0);
      for (let k = 0; k < n; k++) ellipsoidLocal(t, at(k, n), 1.62, up, 0.25, 0.25, 0.02);
      return;
    }
    case "shrine": {
      // A red torii against candlelight, a row of candle flames at its foot.
      const span = Math.min(1.7, iw * 0.8), post = th(0.12);
      ink(t, [196, 50, 34], "#", 0.95);
      for (const s of [-1, 1]) cuboid(t, cx + s * span * 0.34, 2.1, up, post, 1.9, D);
      cuboid(t, cx, 3.12, up, span, th(0.14), D);
      if (near) cuboid(t, cx, 2.8, up, span * 0.78, th(0.1), D);
      if (near) { ink(t, [255, 206, 112], "*", 1.15); cuboid(t, cx, 1.3, z, span * 0.6, 0.14, D); }
      return;
    }
    case "server-hall": {
      // Dark racks with blue LED columns (a green one now and then).
      const n = slots(0.6, near ? 5 : 3);
      if (near) { ink(t, [16, 24, 38], "#", 0.9); cuboid(t, cx, 2.3, z, iw, 2.2, D); }
      for (let k = 0; k < n; k++) {
        ink(t, k % 3 === 2 ? [120, 255, 190] : [110, 190, 255], ":", 1.15);
        cuboid(t, at(k, n), 2.3, up, th(0.08), 2.0, D);
      }
      return;
    }
    case "hydroponics": {
      // A pink grow light over shelves of leaves.
      ink(t, [255, 110, 220], "-", 1.2); cuboid(t, cx, 3.4, z, iw, th(0.08), D);
      if (!near) { ink(t, [96, 210, 120], "&", 0.9); cuboid(t, cx, 2.1, z, iw, 1.2, D); return; }
      const n = slots(0.6, 4);
      for (const shelf of [1.55, 2.5]) {
        ink(t, [60, 70, 64], "="); cuboid(t, cx, shelf, z, iw, th(0.05), D);
        ink(t, [96, 210, 120], "&", 0.95);
        for (let k = 0; k < n; k++) ellipsoidLocal(t, at(k, n), shelf + 0.24, up, 0.26, 0.2, 0.02);
      }
      return;
    }
    case "capsule-hotel": {
      // A wall of small lit hatches, some dark (occupied).
      const cols = slots(0.75, 4);
      if (!near) { ink(t, [190, 224, 255], "o", 1.0); for (const y of [1.85, 2.85]) cuboid(t, cx, y, z, iw, th(0.42), D); return; }
      ink(t, [40, 48, 60], "#", 0.85); cuboid(t, cx, 2.35, z, iw, 2.1, D);
      for (const [row, y] of [1.85, 2.85].entries()) for (let k = 0; k < cols; k++) {
        ink(t, [190, 224, 255], "o", r(row * 5 + k) < 0.3 ? 0.35 : 1.1);
        cuboid(t, at(k, cols), y, up, 0.44, 0.42, D);
      }
      return;
    }
    case "corp-lobby": {
      // Clean white light, a logo bar in the building's accent and a reception desk.
      ink(t, accent, "=", 1.2); cuboid(t, cx, 3.2, z, iw * 0.5, th(0.26), D);
      if (!near) return;
      ink(t, [44, 50, 60], "#", 0.9); cuboid(t, cx, 1.55, z, iw * 0.6, 0.8, D);
      ink(t, [236, 242, 255], "-", 1.1); cuboid(t, cx, 1.97, up, iw * 0.62, th(0.06), D);
      return;
    }
    case "pawnshop": {
      // A caged counter under yellow light, a big '$' above it.
      ink(t, [255, 204, 110], "#", 0.8); cuboid(t, cx, 1.85, z, iw, 1.4, D);
      ink(t, [255, 236, 120], "$", 1.25); cuboid(t, cx, 3.1, up, th(0.6), th(0.6), D);
      return;
    }
    case "market-hall": {
      // Warm stall bulbs on a wire, a striped stall front and produce.
      if (!near) { ink(t, [255, 214, 140], "o", 1.15); cuboid(t, cx, 3.25, z, iw, th(0.18), D); ink(t, [255, 150, 70], "%", 0.85); cuboid(t, cx, 1.45, z, iw * 0.8, 0.5, D); return; }
      ink(t, [60, 50, 40], "-"); cuboid(t, cx, 3.38, z, iw, th(0.04), D);
      const n = slots(0.6, 6);
      ink(t, [255, 214, 140], "o", 1.2);
      for (let k = 0; k < n; k++) cuboid(t, at(k, n), 3.25, up, 0.16, 0.18, D);
      ink(t, [210, 74, 52], "=", 0.8); cuboid(t, cx, 2.85, z, iw * 0.9, 0.22, D);
      ink(t, [255, 150, 70], "%", 0.85); cuboid(t, cx, 1.45, z, iw * 0.8, 0.5, D);
      return;
    }
    case "machine-shop":
    case "garage": {
      // A roll-up shutter half down over sodium light, a bench or a stack of tyres below.
      ink(t, [104, 110, 114], "=", 0.8); cuboid(t, cx, 3.05, up, iw + 0.1, 1.2, D);
      ink(t, [60, 64, 66], "-"); cuboid(t, cx, 2.45, up, iw + 0.1, th(0.08), D);
      if (!near) return;
      if (kind === "garage") { ink(t, [28, 28, 30], "O"); cuboid(t, cx + iw * 0.25, 1.6, z, 0.7, 0.9, D); }
      else { ink(t, [40, 36, 32], "#"); cuboid(t, cx, 1.5, z, iw * 0.7, 0.7, D); }
      return;
    }
    case "chandlery": {
      // A hanging lantern, rope draped across the glass and a coil on the floor.
      const lx = cx + iw * 0.2;
      ink(t, [255, 180, 90], "o", 1.2); ellipsoidLocal(t, lx, 2.95, up, th(0.2), th(0.28), 0.02);
      ink(t, [180, 146, 96], "@", 0.85); ellipsoidLocal(t, cx - iw * 0.25, 1.45, z, 0.42, 0.3, 0.02);
      if (!near) return;
      ink(t, [50, 44, 36], "|"); cuboid(t, lx, 3.43, z, th(0.03), 0.3, D);
      ink(t, [180, 146, 96], "~", 0.8);
      for (const s of [-1, 1]) strutLocal(t, cx + s * iw / 2, 3.35, z, cx, 3.0, z, th(0.05));
      return;
    }
    case "lobby": {
      // A grid of mailboxes and a warm pendant light.
      ink(t, [176, 164, 140], "#", 0.8); cuboid(t, cx - iw * 0.2, 2.0, z, Math.min(1.2, iw * 0.5), 0.9, D);
      if (near) { ink(t, [255, 226, 170], "o", 1.15); cuboid(t, cx + iw * 0.25, 3.2, up, 0.3, 0.24, D); }
      return;
    }
    case "apartment": {
      // Drawn-back curtains and a table lamp.
      ink(t, [170, 86, 70], "|", 0.7);
      for (const s of [-1, 1]) cuboid(t, cx + s * (iw / 2 - 0.25), 2.4, up, th(0.45), 2.3, D);
      if (near) { ink(t, [255, 214, 150], "o", 1.15); cuboid(t, cx + iw * 0.15, 1.9, z, 0.32, 0.36, D); }
      return;
    }
  }
}

function drawWallThing(t: PropCanvas, thing: WallThing, x: number, front: number, seed: number, near: boolean): void {
  if (thing === "vending") {
    const body: RGB = seed < 0.33 ? [178, 46, 58] : seed < 0.66 ? [44, 92, 168] : [196, 200, 204];
    ink(t, body, "#", 0.75); cuboid(t, x, 0.98, front + 0.38, 0.95, 1.95, 0.7);
    ink(t, seed < 0.5 ? [120, 236, 255] : [255, 220, 150], "=", 1.05); cuboid(t, x - 0.08, 1.35, front + 0.74, 0.62, 0.8, 0.03);
    if (near) { ink(t, [30, 34, 40], "-"); cuboid(t, x, 0.42, front + 0.74, 0.62, 0.16, 0.03); }
  } else if (thing === "bags") {
    ink(t, [34, 46, 40], "%");
    for (let k = 0; k < 3; k++) ellipsoidLocal(t, x - 0.35 + k * 0.35, 0.3 + (k === 1 ? 0.18 : 0), front + 0.38, 0.34, 0.3, 0.3);
  } else if (thing === "crates") {
    ink(t, [120, 92, 62], "#");
    cuboid(t, x - 0.2, 0.3, front + 0.38, 0.65, 0.6, 0.65); cuboid(t, x + 0.42, 0.25, front + 0.38, 0.5, 0.5, 0.6);
    if (near) cuboid(t, x - 0.12, 0.82, front + 0.38, 0.5, 0.44, 0.55);
  } else if (thing === "planter") {
    ink(t, [76, 84, 80], "="); cuboid(t, x, 0.3, front + 0.36, 1.5, 0.6, 0.62);
    ink(t, [64, 140, 92], "&"); ellipsoidLocal(t, x, 0.86, front + 0.36, 0.72, 0.45, 0.32);
  } else if (thing === "kiosk") {
    ink(t, [54, 62, 74], "#"); cuboid(t, x, 0.75, front + 0.32, 0.7, 1.5, 0.5);
    ink(t, seed < 0.5 ? [104, 210, 255] : [196, 140, 255], "=", 0.95); cuboid(t, x, 1.15, front + 0.58, 0.5, 0.42, 0.03);
  } else {
    // A bicycle leaning on the wall: two wheels in the wall's plane and a frame (thin parts: close up only).
    if (!near) return;
    ink(t, [40, 44, 50], "O");
    for (const s of [-1, 1]) { t.push(); t.translate(x + s * 0.5, -0.36, front + 0.35); t.rotateX(90); t.torus(0.33, 0.03); t.pop(); }
    ink(t, [200, 70, 60], "/"); strutLocal(t, x - 0.5, 0.36, front + 0.35, x + 0.12, 0.78, front + 0.35, 0.05); strutLocal(t, x + 0.12, 0.78, front + 0.35, x + 0.5, 0.36, front + 0.35, 0.05);
  }
}

/**
 * Hacking (rpg/hacking/sites.ts): a wall-mounted ATM (amber header, lit screen, keypad, cash slot)
 * or a service door's keypad, in the face's frame. The screen follows the session's display state:
 * a cleared "+" for 10 s after a payout with notes pushed out of the slot (an eased 0.5 s slide,
 * they rest there, and slide back in as the state ends), dark then a red lock glyph while locked.
 * No blinking.
 */
function drawHackSite(t: PropCanvas, site: HackSite, front: number, w: number, near: boolean): void {
  const look = hackLook(site.id);
  const locked = look?.look === "locked", dark = locked && look.age < 1.5;
  if (site.kind === "atm") {
    const x = site.along;
    ink(t, [46, 54, 60], "#"); cuboid(t, x, 1.2, front + 0.17, 0.84, 1.7, 0.34);
    ink(t, [255, 196, 92], "=", 0.95); cuboid(t, x, 2.0, front + 0.35, 0.84, 0.16, 0.04);
    if (dark) ink(t, [20, 26, 30], ".", 0.4);
    else if (locked) ink(t, [200, 70, 60], "x", 0.85);
    else if (look?.look === "paid") ink(t, [150, 255, 170], "+", 1.1);
    else ink(t, [96, 236, 200], "$", 1.0);
    cuboid(t, x, 1.55, front + 0.355, 0.56, 0.4, 0.03);
    ink(t, [24, 28, 32], "-"); cuboid(t, x, 0.86, front + 0.36, 0.42, 0.06, 0.04);
    if (near) {
      ink(t, [150, 160, 165], ":", 0.7); cuboid(t, x - 0.1, 1.1, front + 0.36, 0.3, 0.22, 0.04);
      ink(t, [30, 34, 40], "-"); cuboid(t, x + 0.22, 1.12, front + 0.36, 0.12, 0.05, 0.04);
    }
    if (look?.look === "paid") {
      // The notes ease out of the slot over 0.5 s and ease back in over the last 0.6 s of the paid
      // state (taken back when it ends), so they never pop. At p = 0 they sit inside the slot.
      const p = smoothstep(0, 0.5, look.age) * (1 - smoothstep(ATM_PAID_SECONDS - 0.7, ATM_PAID_SECONDS - 0.1, look.age));
      if (p > 0.01) {
        ink(t, [140, 230, 150], "$", 0.95);
        for (const k of [-1, 0, 1]) cuboid(t, x + k * 0.12, 0.86 - p * 0.06, front + 0.36 + p * 0.2, 0.1, 0.04, 0.02 + p * 0.22);
      }
    }
    return;
  }
  // Service door: a keypad on the pilaster right of the door and a bar across the door while it is shut.
  const door = shopDoorWidth(w), x = door / 2 + 0.3, open = look?.look === "open";
  ink(t, [40, 46, 52], "#"); cuboid(t, x, 1.4, front + 0.24, 0.26, 0.4, 0.08);
  if (dark) ink(t, [20, 26, 30], ".", 0.4);
  else if (locked) ink(t, [200, 70, 60], "x", 0.85);
  else if (open) ink(t, [120, 240, 160], "#", 1.0);
  else ink(t, site.tier === "hard" ? [170, 130, 255] : [255, 170, 80], "#", 1.0);
  cuboid(t, x, 1.45, front + 0.29, 0.16, 0.2, 0.02);
  if (!open) { ink(t, site.tier === "hard" ? [120, 96, 190] : [150, 120, 60], "=", 0.6); cuboid(t, 0, 1.05, front + 0.22, door * 0.8, 0.09, 0.05); }
  if (near && site.tier === "hard") { ink(t, [170, 130, 255], "-", 0.8); cuboid(t, 0, 3.2, front + 0.22, door * 0.7, 0.05, 0.04); }
}

/** Beam of square section `w` between two points of the current frame (y up). */
function strutLocal(t: PropCanvas, ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number): void {
  const dx = bx - ax, dy = ay - by, dz = bz - az; // textmode Y points down
  t.push(); t.translate((ax + bx) / 2, -(ay + by) / 2, (az + bz) / 2);
  t.rotateY(Math.atan2(dx, dz) * 180 / Math.PI); t.rotateX(Math.atan2(Math.hypot(dx, dz), dy) * 180 / Math.PI);
  t.box(w, Math.hypot(dx, dy, dz), w); t.pop();
}
function ellipsoidLocal(t: PropCanvas, x: number, y: number, z: number, rx: number, ry: number, rz: number): void {
  t.translate(x, -y, z); t.ellipsoid(rx, ry, rz); t.translate(-x, y, -z);
}
