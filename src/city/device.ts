// Device class helpers (mobile/iPhone support). Call only in the browser (they read window/navigator).

/** A phone or tablet driven by touch first: coarse primary pointer, or touch points without a fine pointer. */
export function isTouchFirst(): boolean {
  if (typeof window === "undefined") return false;
  return matchMedia("(pointer: coarse)").matches || (navigator.maxTouchPoints > 1 && !matchMedia("(pointer: fine)").matches);
}

/** iPhone / iPad (iPadOS reports a Mac user agent but has touch points). */
export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

/** Safari or any iOS browser (all iOS browsers use WebKit). */
export function isWebKit(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return isIOS() || (/Safari\//.test(ua) && !/Chrome|Chromium|Edg\/|OPR\/|Android/.test(ua));
}
