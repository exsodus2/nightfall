import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(`data:text/javascript,${encodeURIComponent('import { extname } from "node:path"; export function resolve(specifier, context, nextResolve) { return nextResolve(specifier.startsWith(".") && extname(specifier) === "" ? `${specifier}.ts` : specifier, context); }')}`, import.meta.url);
const { cityMaterial } = await import("../src/city/materials.ts");

/** The facade branch (SURFACE 0) of the building batch's material. */
function facadeBranch(lite: boolean): string {
  const source = cityMaterial({ batch: true, opaque: true, architecture: true, lite });
  const start = source.indexOf("int style = clamp(int(round((v_cellColor.a");
  const end = source.indexOf("// Outline every massing box", start);
  assert.ok(start > 0 && end > start, "facade branch not found");
  return source.slice(start, end);
}

test("facade animation stays slow: every time-driven term is under 0.5 Hz", () => {
  for (const lite of [false, true]) {
    const branch = facadeBranch(lite);
    const rates = [...branch.matchAll(/u_time \* ([\d.]+)/g)].map(match => Number(match[1]));
    assert.ok(rates.length >= 3);
    // sin(u_time * k) cycles at k / 2pi Hz; motion comfort forbids anything near 3 Hz.
    for (const rate of rates) assert.ok(rate / (2 * Math.PI) < 0.5, `u_time * ${rate} is ${(rate / (2 * Math.PI)).toFixed(2)} Hz`);
  }
});

test("fire-escape strokes are taken in uniform flow, before the per-cell branches", () => {
  const branch = facadeBranch(false);
  const strokes = branch.indexOf("int stairUp = strokeFor("), chain = branch.indexOf("if (style >= 12) {");
  assert.ok(strokes > 0 && chain > strokes);
  // The stair coordinates are continuous (no fract), so their derivatives never jump.
  const line = branch.slice(strokes, branch.indexOf(";", strokes));
  assert.doesNotMatch(line, /fract|floor|mod\(/);
});

test("street-level features need the box (batch only) and never replace the shopfronts' faces with windows", () => {
  const branch = facadeBranch(false);
  assert.match(branch, /groundBox = !roof && style < 12 && !planter && abs\(v_center\.y \+ v_dims\.y \* 0\.5\) < 0\.6;/);
  assert.match(branch, /groundFloor = groundBox && heightCoord < 4\.6;/);
  assert.match(branch, /if \(groundFloor\) windowMask = 0\.0;/);
  // Sills, lintels and AC units sit under or over windows, so they skip the street level too.
  for (const marker of ["// Window sills", "// Lintels", "// Air-conditioning units"]) {
    const at = branch.indexOf(marker), condition = branch.lastIndexOf("} else if (", at);
    assert.ok(at > 0 && branch.slice(condition, at).includes("!groundFloor"), marker);
  }
});

test("close-range wall detail (brick bond, form joints and ties, corrugation shading) only exists where it spans whole cells", () => {
  const branch = facadeBranch(false);
  assert.match(branch, /style == 0 && cellWorld < 0\.42\) \{\s*\/\/ Brick in running bond/);
  assert.match(branch, /style == 1 && !planter && cellWorld < 0\.55\) \{/);
  assert.match(branch, /cellWorld < 0\.3 && max\(tie\.x, tie\.y\) < 0\.5/);
  // Per-panel and per-rib tones fade to their mean before they would alias.
  assert.match(branch, /hash\(floor\(formPanel\)[^;]*\(1\.0 - smoothstep\(0\.7, 1\.3, cellWorld\)\)/);
  assert.match(branch, /if \(style == 8\) paper \*= [^;]*\(1\.0 - smoothstep\(0\.12, 0\.18, cellWorld\)\)/);
});

test("window life is slow, rare and distance-gated: lamps fade over ~2 s, figures within 45 m, TV hue within 90 m", () => {
  for (const lite of [false, true]) {
    const branch = facadeBranch(lite);
    // Each window runs its own 75 s clock (seed-offset, so nothing switches in waves) and fades
    // over 2 s of it; about one window in 280 is flipped per slot.
    assert.match(branch, /float lifeClock = u_time \* 0\.0133 \+ seed \* 7\.0/);
    assert.match(branch, /smoothstep\(0\.0, 0\.027, fract\(lifeClock\)\)/);
    const shares = [...branch.matchAll(/\+ 0\.5\), ([\d.]+)\);/g)].map(match => Number(match[1]));
    assert.equal(shares.length, 2);
    for (const share of shares) assert.ok(share < 0.01, `flip share ${share}`);
    // The lit pane fades to the unlit one instead of stepping.
    assert.match(branch, /if \(litLevel > 0\.02\) \{/);
    assert.match(branch, /paper = mix\(darkPane, paper, litLevel\)/);
    // TV rooms drift hue only within ~90 m and settle on their mean beyond.
    assert.match(branch, /1\.0 - smoothstep\(70\.0, 90\.0, eyeDist\)/);
  }
  const branch = facadeBranch(false);
  // Figures only within ~45 m and once the pane spans five cells, at least a cell and a half wide.
  assert.match(branch, /figureAmount = smoothstep\(5\.0, 6\.5, paneResolution\) \* \(1\.0 - smoothstep\(38\.0, 45\.0, eyeDist\)\)/);
  assert.match(branch, /bodyHalf = max\(0\.13, 0\.75 \/ paneResolution\)/);
  // External lifts and cable bundles: strokes in uniform flow, shafts only while two cells wide.
  const strokes = branch.indexOf("cableStroke = strokeFor("), chain = branch.indexOf("if (style >= 12) {");
  assert.ok(strokes > 0 && chain > strokes);
  assert.match(branch, /liftFace && halfCells > 1\.0 && acrossCells < halfCells/);
});
