export interface HudInsets { top: number; right: number; bottom: number; left: number }
export interface HudViewport { width: number; height: number; touch: boolean; insets?: Partial<HudInsets> }
export interface HudRegion { left: number; top: number; width: number; height: number }
export interface CombatHudLayout { vitals: HudRegion; weapon: HudRegion; boss: HudRegion }

const finite = (value: number | undefined, fallback: number): number => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const clamp = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(maximum, value));

export function combatHudLayout(cols: number, rows: number, viewport?: HudViewport): CombatHudLayout {
  const columns = Math.max(1, Math.floor(finite(cols, 1))), lines = Math.max(1, Math.floor(finite(rows, 1)));
  const originX = Math.floor(columns / 2), originY = Math.floor(lines / 2);
  const region = (left: number, top: number, width: number, height: number): HudRegion => {
    const column = clamp(Math.floor(left), 0, columns - 1), row = clamp(Math.floor(top), 0, lines - 1);
    return { left: column - originX, top: row - originY, width: clamp(Math.floor(width), 1, columns - column), height: clamp(Math.floor(height), 0, lines - row) };
  };
  if (!viewport) {
    const bossWidth = Math.max(1, Math.min(62, columns - 2));
    return {
      vitals: region(1, lines - 3, Math.max(1, Math.floor(columns / 2) - 3), 2),
      weapon: region(Math.max(1, columns - 34), lines - 3, Math.min(32, columns - 3), 2),
      boss: region(originX - Math.floor(bossWidth / 2), 1, bossWidth, 3),
    };
  }
  const width = Math.max(1, finite(viewport.width, columns * 12)), height = Math.max(1, finite(viewport.height, lines * 12));
  const cellWidth = width / columns, cellHeight = height / lines;
  const insetLeft = clamp(finite(viewport.insets?.left, 0), 0, width / 3), insetRight = clamp(finite(viewport.insets?.right, 0), 0, width / 3);
  const insetTop = clamp(finite(viewport.insets?.top, 0), 0, height / 3), insetBottom = clamp(finite(viewport.insets?.bottom, 0), 0, height / 3);
  const portrait = height > width, shortLandscape = viewport.touch && !portrait && (height - insetTop - insetBottom < 360 || width - insetLeft - insetRight < 700);
  const margin = viewport.touch ? 16 : width > 768 ? 40 : 24;
  const firstColumn = clamp(Math.ceil((insetLeft + margin) / cellWidth), 0, columns - 1);
  const rightMargin = viewport.touch && !portrait ? 132 : margin;
  const lastColumn = clamp(Math.floor((width - insetRight - rightMargin) / cellWidth), firstColumn + 1, columns);
  const available = lastColumn - firstColumn;
  if (shortLandscape) {
    const gapLeft = Math.ceil((insetLeft + Math.min(250, width * 0.38) + 32) / cellWidth);
    const gapRight = Math.floor((width - insetRight - 132) / cellWidth);
    const railWidth = Math.max(1, Math.min(36, gapRight - gapLeft));
    const railLeft = clamp(gapLeft, firstColumn, Math.max(firstColumn, lastColumn - railWidth));
    const railTop = clamp(Math.ceil((insetTop + 64) / cellHeight), 0, Math.max(0, lines - 7));
    return { boss: region(railLeft, railTop, railWidth, 3), vitals: region(railLeft, railTop + 3, railWidth, 2), weapon: region(railLeft, railTop + 5, railWidth, 2) };
  }
  const stacked = portrait && viewport.touch || available < 52;
  const bottomInset = viewport.touch ? portrait ? 184 : 160 : stacked ? 104 : height <= 550 ? 36 : 48;
  const railEnd = clamp(Math.floor((height - insetBottom - bottomInset) / cellHeight), stacked ? Math.min(5, lines) : Math.min(2, lines), lines);
  const railTop = Math.max(0, railEnd - (stacked ? 5 : 2));
  const weaponWidth = stacked ? Math.min(40, available) : Math.min(32, Math.floor((available - 2) * 0.4));
  const vitalsWidth = stacked ? Math.min(64, available) : Math.min(64, available - weaponWidth - 2);
  const vitals = region(firstColumn, railTop, vitalsWidth, 2);
  const weapon = region(stacked ? firstColumn : lastColumn - weaponWidth, stacked ? railEnd - 2 : railTop, weaponWidth, 2);
  let bossLeft = firstColumn, bossRight = lastColumn;
  if (!portrait && width >= 640) {
    bossLeft = Math.max(firstColumn, Math.ceil((insetLeft + (viewport.touch ? Math.min(250, width * 0.38) + 32 : 360)) / cellWidth));
    if (viewport.touch) bossRight = Math.min(lastColumn, Math.floor((width - insetRight - 132) / cellWidth));
  }
  const bossWidth = Math.max(1, Math.min(62, bossRight - bossLeft));
  const centeredLeft = Math.floor((columns - bossWidth) / 2);
  bossLeft = clamp(centeredLeft, bossLeft, Math.max(bossLeft, bossRight - bossWidth));
  const bossInset = viewport.touch ? portrait ? 208 : 64 : height <= 550 ? 100 : 126;
  const bossTop = clamp(Math.ceil((insetTop + bossInset) / cellHeight), 0, Math.max(0, railTop - 4));
  const boss = region(bossLeft, bossTop, bossWidth, Math.min(3, Math.max(0, railTop - bossTop)));
  return { vitals, weapon, boss };
}

export function fitHudText(value: string, width: number): string {
  const length = Math.max(0, Math.floor(finite(width, 0)));
  if (!length) return "";
  const text = value.slice(0, length).replace(/[^\x20-\x7e]/g, "?");
  if (value.length <= length) return text;
  return length < 4 ? ".".repeat(length) : `${text.slice(0, length - 3)}...`;
}

export function hudNumber(value: number): string {
  const amount = Math.max(0, Math.ceil(finite(value, 0)));
  if (amount < 10000) return String(amount);
  if (amount < 1_000_000) return `${Math.floor(amount / 1000)}k`;
  if (amount < 1_000_000_000) return `${Math.floor(amount / 1_000_000)}m`;
  return `${Math.min(999, Math.floor(amount / 1_000_000_000))}b`;
}

function labelOverlap(region: HudRegion, left: number, right: number, top: number, bottom: number): boolean {
  return region.width > 0 && region.height > 0 && left < region.left + region.width && right > region.left && top < region.top + region.height && bottom > region.top;
}

function labelBlocked(layout: CombatHudLayout, bossVisible: boolean, left: number, right: number, top: number, bottom: number): boolean {
  return labelOverlap(layout.vitals, left, right, top, bottom) || labelOverlap(layout.weapon, left, right, top, bottom) || bossVisible && labelOverlap(layout.boss, left, right, top, bottom);
}

export function combatLabelRow(center: number, top: number, width: number, height: number, rows: number, layout: CombatHudLayout, bossVisible: boolean): number | null {
  if (!Number.isFinite(center) || !Number.isFinite(top) || !Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(rows) || width < 1 || height < 1 || rows < 1) return null;
  const left = center - Math.floor(width / 2), right = left + width;
  if (!labelBlocked(layout, bossVisible, left, right, top, top + height)) return top;
  const first = -Math.floor(rows / 2), last = Math.ceil(rows / 2);
  for (let attempt = 1; attempt <= 8; attempt++) {
    const candidate = top + (attempt % 2 ? -1 : 1) * Math.ceil(attempt / 2);
    if (candidate >= first && candidate + height <= last && !labelBlocked(layout, bossVisible, left, right, candidate, candidate + height)) return candidate;
  }
  return null;
}
