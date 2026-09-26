// Builds the Colyseus server: one room type, WebSocket transport (@colyseus/ws-transport, which
// `colyseus` installs), a plain-text health page at "/", and optional origin allow-listing.
// With `site` set it also serves the game website from the same address (one domain, one proxy).
import http from "node:http";
import { Server, matchMaker } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ROOM_NAME } from "../src/multiplayer/protocol.ts";
import { NightfallRoom } from "./room.ts";

export interface NightfallServerOptions {
  /** Allowed page origins (e.g. "https://city.example.com"). Empty: any origin may connect. */
  origins?: readonly string[];
  greet?: boolean;
  /** Serve the website too: every request that isn't matchmaking or /healthz is passed through to
   *  this Next.js server (e.g. "http://127.0.0.1:3001"), so a single reverse proxy to this port
   *  carries both the site and the room sockets. */
  site?: string;
}

export function parseOrigins(value: string | undefined): string[] {
  return (value ?? "").split(",").map(origin => origin.trim().replace(/\/+$/, "")).filter(Boolean);
}

export function createNightfallServer(options: NightfallServerOptions = {}): { gameServer: Server; httpServer: http.Server } {
  const origins = options.origins ?? [];
  const allowed = (origin: string | undefined) => !origins.length || (!!origin && origins.includes(origin));
  const site = options.site ? new URL(options.site) : null;
  // Opening the server URL (or its tunnel) in a browser shows this, which makes tunnels easy to test.
  const httpServer = http.createServer((req, res) => {
    if (site && req.url !== "/healthz") { forward(site, req, res); return; }
    const health = req.url === "/" || req.url === "/healthz";
    res.writeHead(health ? 200 : 404, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
    res.end(health ? "Nightfall multiplayer server is running. Paste this address into the game's Online panel.\n" : "Not found\n");
  });
  // The browser client sends this header through ngrok (skips its free-tier warning page).
  const cors = matchMaker.controller.DEFAULT_CORS_HEADERS;
  if (!cors["Access-Control-Allow-Headers"].includes("ngrok-skip-browser-warning")) cors["Access-Control-Allow-Headers"] += ", ngrok-skip-browser-warning";
  if (origins.length) {
    // Matchmaking is plain HTTP (CORS); the room socket is checked when it upgrades.
    matchMaker.controller.getCorsHeaders = (req: http.IncomingMessage) => {
      const origin = req.headers.origin;
      return allowed(origin) ? { "Access-Control-Allow-Origin": origin ?? "" } : { "Access-Control-Allow-Origin": "null" };
    };
  }
  const transport = new WebSocketTransport({
    server: httpServer,
    verifyClient: (info: { origin: string }) => allowed(info.origin || undefined),
  });
  const gameServer = new Server({ transport, greet: options.greet ?? false });
  gameServer.define(ROOM_NAME, NightfallRoom);
  return { gameServer, httpServer };
}

// Streams one request to the site server, keeping the public host so Next.js builds correct URLs.
function forward(site: URL, req: http.IncomingMessage, res: http.ServerResponse): void {
  const headers: http.OutgoingHttpHeaders = {
    ...req.headers,
    "x-forwarded-host": req.headers["x-forwarded-host"] ?? req.headers.host ?? "",
    "x-forwarded-proto": req.headers["x-forwarded-proto"] ?? "http",
  };
  const upstream = http.request({ hostname: site.hostname, port: site.port || 80, method: req.method, path: req.url, headers }, reply => {
    res.writeHead(reply.statusCode ?? 502, reply.headers);
    reply.pipe(res);
  });
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("The Nightfall site server is not running.\n");
  });
  req.pipe(upstream);
}
