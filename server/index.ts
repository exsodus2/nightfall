// `npm run server`: the Nightfall multiplayer server (Colyseus) on PORT (default 2567).
// Environment: PORT, HOST (default 0.0.0.0), ALLOWED_ORIGINS (comma-separated page origins; unset = any).
import { DEFAULT_PORT } from "../src/multiplayer/protocol.ts";
import { createNightfallServer, parseOrigins } from "./app.ts";

const port = Number(process.env.PORT) || DEFAULT_PORT;
const host = process.env.HOST || "0.0.0.0";
const origins = parseOrigins(process.env.ALLOWED_ORIGINS);
// SITE_URL (optional): also serve the website from this address by passing through to Next.js.
const site = process.env.SITE_URL || undefined;
const { gameServer } = createNightfallServer({ origins, site });

gameServer.listen(port, host).then(() => {
  console.log(`Nightfall multiplayer server listening on ws://localhost:${port}`);
  if (site) console.log(`Serving the website from ${site} on the same address.`);
  console.log(origins.length ? `Accepting pages from: ${origins.join(", ")}` : "Accepting pages from any origin (set ALLOWED_ORIGINS to restrict).");
  console.log("Share it with friends through a tunnel, e.g.  cloudflared tunnel --url http://localhost:" + port);
}, (error: unknown) => {
  console.error(`Could not start on port ${port}:`, error instanceof Error ? error.message : error);
  process.exit(1);
});
