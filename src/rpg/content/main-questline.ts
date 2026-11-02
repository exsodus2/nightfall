// The main questline, "The Rain That Remembers": the five act packs in story order. The story bible
// is docs/story.md; shared ids, flags and positions are in main-common.ts.

import type { ContentPack } from "../types.ts";
import { MAIN_ACT1_PACK } from "./main-act1.ts";
import { MAIN_ACT2_PACK } from "./main-act2.ts";
import { MAIN_ACT3_PACK } from "./main-act3.ts";
import { MAIN_ACT4_PACK } from "./main-act4.ts";
import { MAIN_ACT5_PACK } from "./main-act5.ts";

/** Act 1 (Silk Market, Dead Letter) to Act 5 (Rain Gardens, the Spire, the last delivery). */
export const MAIN_QUESTLINE_PACKS: readonly ContentPack[] = [MAIN_ACT1_PACK, MAIN_ACT2_PACK, MAIN_ACT3_PACK, MAIN_ACT4_PACK, MAIN_ACT5_PACK];

export { MAIN_ACT1_PACK, MAIN_ACT2_PACK, MAIN_ACT3_PACK, MAIN_ACT4_PACK, MAIN_ACT5_PACK };
