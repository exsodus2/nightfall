// Text the city scrolls around its towers and projects into the rain. Kept under 62 characters
// (one row of the text texture). All brands are fictional.
export const MESSAGES: readonly string[] = [
  "AFTERLIGHT ARCADE  //  OPEN UNTIL THE END OF THE WORLD",
  "SHIMADA DYNAMICS  +4.21%   KOWA SYSTEMS  -1.07%   NAMI +0.88%",
  "ACID RAIN ADVISORY  PH 4.2  WIND NE 31 KM/H  VISIBILITY 400 M",
  "REAL MEMORIES. SYNTHETIC PRICES. MNEMOSYNE CLINICS",
  "CITY LOOP 04 ARRIVING  //  SILK MARKET 2 MIN  //  FOUNDRY 7 MIN",
  "DRINK KOI  //  COLD BREW FOR A WARM PLANET",
  "CURFEW LEVEL 2 IN EFFECT 02:00 - 05:00  //  CARRY YOUR PAPERS",
  "KILN NINE  //  WE FIX WHAT THE FURNACE BROKE",
  "VANTA AIR  //  ABOVE THE WEATHER  //  SKY TAXI 24 HRS",
  "MISSING: UNIT RX-40  REWARD 25000 CR  CALL 0800-555-2049",
  "SEVEN SEAS NOODLE  //  OPEN ALL NIGHT  //  ALL NIGHT OPEN",
  "ORBIT BANK: YOUR DEBT, OUR FUTURE",
  "NEON WARD NIGHT MARKET  THU-SUN  2200 - 0600",
  "ATLAS ARCOLOGY  //  1,209 FLOORS OF PEACE AND QUIET",
  "EMERGENCY BROADCAST TEST  //  THIS IS ONLY A TEST",
  "SABLE OPTICS  //  SEE WHAT THEY DO NOT WANT YOU TO SEE",
  "DEAD LETTER EXCHANGE  //  SIGNED NOTICES ONLY  //  101010",
  "EARTH WAS NICE. MARS IS NICER. TERRAFORM CORP",
  "LOTUS PHARMA  //  SLEEP IS A CHOICE",
  "HANA RAMEN  //  24 HRS  //  REAL EGG +3 CR",
  "GLASSHOUSE SEED SWAP  //  SUNDAYS  //  BRING A POT",
  "TEMP 11 C  //  HUMIDITY 98%  //  UV 0  //  STARS 0",
  "MORI MOTORS  //  THE SPINNER-9  //  FLY HOME TONIGHT",
  "MERIDIAN SPIRE  //  OBSERVATION DECK FLOOR 90  //  40 CR",
  "NEWS: GRID OUTAGE IN GHOST CIRCUIT ENTERS DAY 3",
  "KOWA SYSTEMS -3.40%  //  ORBIT BANK +0.12%  //  JADE +7.7%",
  "SPILLWAY TIDE WARNING  //  DOCKS 4-9 CLOSED  //  STAY HIGH",
  "FRESH SOY PROTEIN 2 CR  //  REAL RICE 19 CR  //  NO REFUNDS",
  "CORPSEC NOTICE: MASKS MUST NOT DEFEAT FACIAL RECOGNITION",
  "FURNACE 3 BACK ONLINE  //  FOUNDRY NIGHT SHIFT HIRING",
  "LOST SIGNAL? DEAD CHANNEL? AHN REPAIR FIXES IT IN 1 HOUR",
  "SILK MARKET LANTERN NIGHT  //  FRIDAY  //  FREE TEA",
  "UPGRADE YOUR EYES  //  SABLE OPTICS  //  0% FINANCE",
  "AIR QUALITY POOR  //  FILTER MASKS AT EVERY KIOSK 3 CR",
  // Secrets (secrets.ts): a numbers station (A=1: MANHOLE BEHIND ARCADE) and a found-cat notice.
  "NUMBERS STATION 13.1.14.8.15.12.5 2.5.8.9.14.4 1.18.3.1.4.5",
  "FOUND: ONE BLACK CAT. ANSWERS TO NOTHING. FOLLOWS KIND FOLK",
];

/** Short sign texts by district (The Foundry, Neon Ward, Ghost Circuit, Rain Gardens, Silk
 * Market, The Spillway), for the corner towers' stacked letters and the boxed and back-lit shop
 * signs (signage.ts). Packed sign alphabet only (A-Z, 0-9, space), at most 16 letters; the
 * corner towers use the first word, so those lead with a short one. All brands are fictional. */
export const DISTRICT_SIGNS: readonly (readonly string[])[] = [
  ["KILN 9", "WELD SHOP", "STEEL", "SCRAP CASH", "FORGE BAR", "RIVET", "SMELT", "CRANE HIRE", "OIL 24H", "SPARK WORKS"],
  ["HOTEL", "KARAOKE", "PACHINKO", "LOVE HOTEL", "NEON", "CLUB ZERO", "SAKE", "AKIRA", "BAR 99", "DREAM", "CYBER SPA", "LUCKY 7"],
  ["SIGNAL", "RADIO", "DEAD AIR", "GHOST NET", "VOID", "STATIC", "ANTENNA", "ECHO DATA", "CABLE TV", "RELAY"],
  ["SEEDS", "GREEN TEA", "FLORA", "MOSS BAR", "HERBS", "RAIN CAFE", "FERN", "LOTUS", "SPROUT"],
  ["SILK", "TEA", "NOODLE", "DUMPLING", "JADE", "PEARL", "SUSHI 24H", "DIM SUM", "HANA", "SOUP 3 CR", "GOLD"],
  ["BAIT", "DOCK 7", "FISH", "CHEAP EATS", "BEER", "PAWN", "MOTEL", "CASH 4 PARTS", "ROOMS", "TACKLE"],
];

/** Small insert signs in shop windows (OPEN, 24H, ...): packed alphabet, at most 10 letters. */
export const INSERT_SIGNS: readonly string[] = [
  "OPEN", "24H", "OPEN 24H", "ATM", "BAR", "NO VACANCY", "VACANCY", "HOT FOOD", "CASH ONLY", "OPEN LATE", "TAX FREE", "REPAIRS",
];
