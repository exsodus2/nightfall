// Multiplayer settings remembered in this browser: display name, server address, and whether the
// player left the public city room (they then stay solo on later visits until they join again).
export const MULTIPLAYER_ENV_URL = process.env.NEXT_PUBLIC_MULTIPLAYER_URL;

const NAME_KEY = "nightfall:mp-name";
const SERVER_KEY = "nightfall:mp-server";
const SOLO_KEY = "nightfall:mp-solo";

function stored(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } }
function store(key: string, value: string | null): void {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* private mode: not remembered */ }
}

export const storedName = (): string | null => stored(NAME_KEY);
export const storeName = (name: string): void => store(NAME_KEY, name);
export const storedServer = (): string | null => stored(SERVER_KEY);
export const storeServer = (url: string): void => store(SERVER_KEY, url);
export const prefersSolo = (): boolean => stored(SOLO_KEY) === "1";
export const setPrefersSolo = (solo: boolean): void => store(SOLO_KEY, solo ? "1" : null);
