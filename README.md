# Nightfall

A first-person cyberpunk city rendered in live ASCII with **textmode.js**, its official **synth** addon, and its official **filters** addon. Built with Next.js App Router, React, strict TypeScript, and Tailwind CSS.

## Run

Requires Node.js 22.6 or newer and a browser with WebGL2.

```powershell
npm install
npm run dev
```

Open **http://127.0.0.1:3000**. Click **Enter the city** to capture the mouse and walk.

The loading screen follows the actual lighting, scene and glyph preparation stages rather than showing an estimated percentage. A first visit can take longer while the browser prepares graphics. Rebuilding after graphics loss uses the same status screen and waits for you to resume when ready.

## Public domain hosting

For `https://city.optimisticroc.com`, point the reverse proxy at this machine's HTTP port **3173**, with WebSocket upgrades enabled. This port serves both the website and multiplayer.

Set `NEXT_PUBLIC_MULTIPLAYER_URL=wss://city.optimisticroc.com` in `.env.production.local`, then run `npm run build`. Start `npm run start:site` and `npm run server:public` in separate terminals. The website listens internally on `127.0.0.1:3001`; `server/public.env` configures the public gateway on `0.0.0.0:3173`.

## Explore

- A deterministic 1,536 × 1,536 metre world: **576 city blocks and over 2,200 buildings**.
- Six districts with a connected street and alley network, six discoverable landmarks, and building collision.
- Six walkable district interiors: Kiln Nine's workshop, Undertone's listening bar, Dead Letter Exchange's relay room, The Glasshouse's conservatory, Blue Hour Tea, and Second Life Salvage. Use **T → Step inside → a venue**, then **E** at its lit doorway. Each has furniture collision, residents, a room-layout minimap, and restrained steam, drifting motes or animated equipment. Return to the lit exit and press **E** to leave.
- Active interior stations appear as amber **USE** squares on the floorplan, with accessible labels and room-relative directions. Markers follow your quest progress; player and friend dots remain above them.
- **M → Places to go** lists all six interiors and tracks their real street entrances without teleporting. Doorway markers appear on both maps, and quest-giver markers follow the current registered content, including Mira's night-shift jobs.
- **Night Shift quests:** meet Mira Bell outside Blue Hour Tea. Carry a grow-light manifest through four real interiors, then choose who receives a late-night radio channel. Entries count only after accepting the job; progress, decisions and rewards persist.
- Open **J → Track contract** to choose which active job guides your HUD and map. Tracking saves immediately, stays in the ledger without resuming play, and falls back to remaining work when that job closes.
- **Kiln Nine workbench:** approach the right-hand machine's **USE** panel and press **E**. Read its calibration plate, diagnose mistakes safely and certify a Shield Cell. Leaving midway preserves progress; the reward is granted once.
- **Last Good Signal:** take a public bulletin job at Dead Letter Exchange's back counter. Log evidence at the archive and relay, verify the latest signed notice, choose its destination and publish with or without a consented callback. Mistakes remain retryable; progress and the final receipt survive reloads, with a single payout.
- **A Little Night:** read Neri's growing board inside the Glasshouse, tend two rainfern trays with different needs, then restore the nursery lamp's timer. Tend the planters in either order, retry mistakes without losing progress, and leave with one paid care receipt.
- **The Space Between:** plan Undertone's last listening set at its counter, listening table and sleeve archive. Choose either quiet mood on silent cue cards, preserve its two rests and collect one payment. No audio, rhythm timing or radio changes are required; choices and the final receipt persist.
- Small fixture-mounted readouts show actual planter care, workshop calibration and bulletin publication progress. They survive reloads with your quests and add at most 21 flat quads in the occupied room, or 15 in low detail; unopened interiors add none.
- Eight architectural families with varied masonry, window spacing, balconies, industrial pipes and rooftop machinery; hundreds of shop-name combinations, recessed storefronts, awnings, vending machines, lanterns and hanging utilities.
- Traffic follows signals, queues behind other cars, and yields to nearby walking players and residents already crossing. A blocked junction holds perpendicular arrivals until it clears. Pedestrian awareness uses a bounded reusable buffer rather than all-pairs collision checks. Residents follow pavement routes, wait at crossings, browse shops and make deliveries. Fifty-four commuters board trains, sit, alight, use lifts and visit station markets before returning.
- Close-up residents have articulated limbs, layered clothing, visible faces, varied hair and headwear, handheld props and idle gestures. Distant silhouettes use a small geometry budget; umbrella poles and canopies share one centred attachment.
- Nearby residents notice players, offer short district-specific remarks and find safe pavement detours around someone in their way. Awareness is distance-limited and speech is rate-limited; distant residents retain cheap routines.
- Facade glass has angle-dependent sky reflections, recessed room detail, stable frames and mullions. Fine details fade with cell footprint, and touch devices use a lighter shader variant.
- Air traffic, steam vents, world-mounted signs, restrained reflective puddles, rain and live synth billboards.
- Ground taxis validate their pickup and dropoff paths against fixed walking obstacles before following the street grid; a disconnected pickup leaves you in place with directions to try a street or sky taxi. Sky taxis take off, fly above the towers, and land. The monorail is a physical four-train service with six stations, working lifts, sliding doors and three connected carriages you can walk through.
- Drivable cars: walk up to one of the ~1,300 cars parked along the kerbs (or a traffic car stopped at a light) and press **E**. W/S or ↑/↓ throttle, brake and reverse; A/D or ←/→ steer; Space handbrake; Shift boost; V (or the **V · Cockpit / Chase** button in the driving HUD) switches between the cockpit, with bonnet, pillars, mirrors and a steering wheel that turns in your hands, and a chase camera behind the whole car; the switch eases over 0.4 s and the last choice is remembered for the next car; E (when slow) steps out onto the pavement. Cars collide with buildings, rail pillars and other cars, traffic queues behind yours, and a car you leave stays where you parked it. Flight is disabled while driving; T, taxis and the monorail park the car first.
- Walking, sprinting, jumping, and free flight, plus a live minimap (north-up or heading-up) and the elevated rail loop.
- Walking and dodging respect nearby parked and traffic car footprints. Swept collision prevents corner-cutting, allows escape from a moving car's overlap and leaves elevated platforms and flight unaffected.
- Street arrivals also check nearby vehicles. Landing, car exits, venue exits and map travel search only a small local area; blocked optional actions leave you where you are. If a completed trip has nowhere safe to stand, you hover above traffic until you can move or land.
- The ASCII health, stamina, weapon and boss displays fit around the footer, minimap and touch controls. Narrow screens shorten labels and bars before sacrificing health or ammunition numbers; layout is cached rather than measured every frame.
- Cars have round tyre sidewalls without square backings, plus a complete rear cockpit with seats, headrests, rear-door trim, a parcel shelf and an open rear-window view.
- **City map (M)**, World-of-Warcraft style: a large translucent overlay drawn as a terminal — every block, building, street and the rail loop re-sampled into ASCII characters in district tints, redrawn (never scaled) at any zoom. Zoom smoothly with the wheel (toward the cursor), **+ / −** or the buttons; drag to pan; **H** or ◎ centres on you. Zoomed out it shows districts and landmarks; zoomed in, street names, then individual buildings with their shop signs and heights. Moving trains, stations, quest givers and targets, friends and your heading are live. **The city does not pause**: the mouse is released for the map, but traffic, trains and rain keep going and **WASD keeps walking**; M or Esc closes it and recaptures the mouse.
- **Waypoints**: click (or right-click) the map to drop one; name it, colour it, track it, share it or remove it from the list (right-click a pin, or **Del**, removes it). The tracked waypoint lights a tall beacon in the 3D city that can be seen from anywhere, a compass tape with bearing and distance at the top of the HUD, and a pin or edge chevron on the minimap. **Share** sends it to friends in your online room; **Copy link** makes a `?wp=x,z,label` URL that adds the waypoint for whoever opens it — no server needed. Your waypoints are remembered in this browser.
- **In-game radio** streaming [Nightride FM](https://nightride.fm) (Nightride, Chillsynth, Datawave, Spacesynth, Darksynth, Horrorsynth, EBSM, plus Rekt and Rektory from the sister [Rekt Network](https://rekt.network)). Hotkeys work while you keep moving with the mouse captured; the HUD widget (above the minimap) is clickable whenever the pointer is free and on touch screens. Shows the live artist and title, a spectrum meter, volume and a station flash; while driving it becomes the car head unit. It never starts on its own: the first press of **R** or ▶ starts it, and station, volume, mute and on/off are remembered in this browser (a radio left on resumes on your next click or key press). The rain ambience ducks while it plays. The station list has an option to pause while the tab is hidden (off by default).
- Optional rain ambience, bloom, adjustable character detail, and sensitivity. Ambient animation starts enabled; Settings can freeze it. UI transitions respect the OS reduced-motion preference.

| Control | Action |
| --- | --- |
| W A S D | Walk / fly / strafe / move inside a train |
| Mouse | Look |
| Shift | Run / flight boost |
| Space | Jump / rise in flight |
| Q / C (or Control) | Rise / descend in flight |
| F | Toggle free flight |
| T | Choose transportation and destination |
| E | Enter / leave a venue, talk to a nearby person, use station lift, board / alight, exit taxi, land, get in / out of a car |
| V | While driving: cockpit / chase camera (remembered) |
| Arrow up / down | Walk forward / backward |
| Arrow left / right | Turn |
| M | Open / close the city map (the city keeps running; WASD still walks) |
| Map: click, right-click, drag, wheel | Drop a waypoint (right-click a pin removes it), pan, zoom toward the cursor |
| Map: + / − , H, Del, Esc | Zoom, centre on me, remove the selected waypoint, close |
| N ↑ above the minimap | Toggle north-up / heading-up minimap |
| J | Open or close the quest log (also: the credits / tracked-quest HUD, or **Quests** in the header) |
| 1–9, ↑ / ↓ + Enter, Esc | In a conversation: choose a response, move and confirm, or leave (Space / Enter / click skips the typed text) |
| R | Radio on / off |
| , / . (or [ / ]) | Previous / next radio station |
| - / = | Radio volume down / up (zoom instead while the city map is open) |
| N | Mute / unmute the radio |
| Enter | Online: open the room chat; Enter sends, Esc closes (game keys are ignored while typing) |
| Left mouse | Attack: tap for light (3-hit combo), hold and release for a heavy / fire the gun in hand (hold for automatic) |
| Right mouse | Block with a melee weapon (start just before a hit to parry) / aim a gun |
| C (on foot) | Dodge roll in the direction you move (brief invulnerability) |
| X | Reload |
| 1 / 2 / 3 / 4 | Melee / sidearm / primary / holster (fists) |
| Q / Z (on foot) | Use quick item 1 / 2 (stims, medkits, buffs) |
| E (on loot or objects) | Pick up dropped loot / use terminals, crates and other marked objects |
| Escape | Pause and release mouse |
| Touch: left thumb | Floating joystick: walk / fly (analog); push past the ring to run; in a car steer + gas / brake |
| Touch: right thumb | Swipe to look (optional gyro aim in Settings) |
| Touch buttons | Interact (labelled, appears when something is in reach), Jump, Fly / Rise / Down / Land, Brake / Cam in a car, Pause, ≡ menu (Map, Transit, Quests, Radio, Chat, Online, Settings) |
| Drag the city | Look when mouse capture is unavailable (desktop) |

The camera starts at street level. Relative mouse input uses raw deltas where supported and frame-rate-independent smoothing. Travel, discoveries, and settings last for the current page session. Buildings retain solid exterior footprints; six marked venues switch into a separate walkable room on entry. Only the occupied room is drawn: no exterior buildings, reflections or rain, and no geometry for unopened rooms. Pausing or saving indoors preserves a safe outdoor return position. For rail travel, choose **T → Monorail → a station** to visit its street entrance, press **E** for the lift, then approach an open carriage door. Walk through the train with WASD; alight at an open door at the next station.

## iPhone and other phones

Nightfall runs in Safari on iPhone (tuned for an iPhone 16, landscape first; portrait works too). Tap **Enter the city**: there is no mouse capture on iOS, nothing waits for it.

- **Controls.** The left thumb gets a floating joystick that appears where you touch (the lower-left 45% of the screen, below the HUD). The push sets your speed; push past the ring (it turns amber) to run. In a car the same stick steers (left / right) and drives (up = gas, down = brake, then reverse); past the ring boosts; **Brake** is the handbrake and **Cam** switches cockpit / chase. The right thumb swipes to look (fast flicks turn further; speed and acceleration in **Settings → Touch controls**; **Gyro aim** is off by default and asks for motion access, which iOS only grants over HTTPS). Buttons fire on touch-down and every finger is tracked on its own, so moving, looking and pressing a button work at the same time. **Interact** (the E action: talk, get in / out of a car, lift, board / alight) only appears when something is in reach and is labelled with it. **≡** opens Map, Transit, Quests, Radio (the radio widget is hidden on phones until you open it), Chat (online), Online and Settings.
- **City map on touch.** Pinch to zoom, drag to pan, tap to drop a waypoint (or select a pin), long-press a pin to remove it.
- **Chat on touch.** Tap **Chat** beside Pause/Menu (or ≡ → Chat). Closed chat keeps the city and health display clear; incoming player messages show a brief excerpt and an unread badge, not a permanent log of join notices. Opening chat restores its roster and history above the keyboard. Inputs use 16 px text so iOS does not zoom.
- **Full screen.** iPhone has no Fullscreen API for a canvas: use **Share → Add to Home Screen**. The home-screen app starts full screen (web app manifest + apple-touch-icon, status bar over the dark city). The layout respects the notch / Dynamic Island and the home indicator (`viewport-fit=cover` + safe-area insets) and follows Safari's collapsing toolbar (`100dvh`, canvas resized on rotation). In portrait a small dismissible hint suggests landscape.
- **Quality.** Phones start on **Settings → Detail level → Auto**: 10 CSS px characters in landscape (8 in portrait) at a pixel density of at most 2 (a DPR 3 phone never renders at 3), draw distance 8 blocks, a lighter material (6-step light-cone scattering, sin-free hash) and all the Blade Runner parts (fog, neon, signs, tickers, holograms, reflections, bloom). A frame-time governor steps down when frames are missed (shorter view and prop ranges → sky-only puddle reflections and no cone scattering, 12 px characters → 14 px characters without holograms and bloom) and only climbs back after 20 s of clean frames with CPU headroom; a level that fails right after climbing back becomes the best allowed, so it never oscillates. The loop is capped at 60 fps; hidden tabs stop rendering.
- **Audio.** Rain and the radio start only from your taps (touch activation happens on release on iOS). Web Audio plays with the ring / silent switch on (Safari 16.4+ `navigator.audioSession`).
- **Lost graphics context.** iOS can reclaim a background tab's GPU memory; instead of a dead canvas you get **Rebuild the city**, which recreates the renderer where you were.

### Test on your phone

The dev server listens on 127.0.0.1 only. Either stop it and start it on the LAN, then open `http://<your PC's IP>:3000` on the phone (same Wi-Fi; `ipconfig` shows the IP; allow Node through the Windows firewall):

```powershell
npx next dev --hostname 0.0.0.0
```

or keep it and tunnel it (HTTPS, needed for gyro aim): `cloudflared tunnel --url http://localhost:3000` and open the `https://….trycloudflare.com` URL (see *Invite friends over the internet* below; `next.config.ts` allows LAN and tunnel origins for the dev server). In Safari on the Mac, **Develop → [your iPhone]** shows the phone's console.

Checklist (Safari, then again from the Home Screen icon):

1. Landscape: Enter the city; hold the stick and swipe to look at the same time, then tap Jump with a third finger. Push past the ring: amber ring, running speed.
2. No page scroll, pinch zoom, double-tap zoom, text selection, magnifier or long-press menu anywhere on the game (try the HUD, the stick and the look area).
3. Walk to a person / parked car: the Interact button appears with the right label; talk (dialogue options are tappable), get in, drive with the stick, Brake, Cam, slow down and get out.
4. Fly, Rise / Down, Land. ≡ → Map: pinch, drag, tap a waypoint, long-press it to remove, Close. ≡ → Transit, Quests, Settings, Radio (starts only when you tap ▶; plays with the silent switch on).
5. Rotate to portrait and back: the picture fills the screen with no stretching; nothing sits under the notch, Dynamic Island or home indicator; the rotate hint appears in portrait only.
6. Online: create a room, ≡ → Chat: the keyboard opens, the chat stays visible above it, Send works, the page does not zoom.
7. Performance: Settings shows *Auto · level N*; after a few minutes of walking and driving it should stay at level 0–1 with smooth motion (the fps readout is on the pause screen). Watch for heat / dimming after 10 minutes.
8. Switch apps for a minute and come back (the city pauses and resumes; if iOS dropped the GPU context, Rebuild the city works). Add to Home Screen and launch it: full screen, no Safari toolbar.

`node scripts/mobile-check.mjs --gpu` emulates an iPhone 16 in Chrome (Safari user agent, 852×393 / 393×852 at DPR 3, synthesized multi-touch: stick + look + Jump at once, drawer, map pinch / tap, portrait), samples frame and CPU times (`?perf=1`) and saves screenshots in `artifacts/mobile/`; `--cpu=4` throttles the CPU to watch the governor. `scripts/mobile-modes.mjs` drives the car / flight buttons and simulates a lost WebGL context, `scripts/mobile-chat.mjs` checks chat with the keyboard (needs `npm run server`), `scripts/mobile-profile.mjs` writes a CPU profile. Chrome is not WebKit: these check layout, input and the render profile, not Safari itself.

## Multiplayer (optional)

Play with friends in the same city through a small [Colyseus](https://colyseus.io) server (`colyseus` 0.16 + `@colyseus/schema` 3 on the server, `colyseus.js` 0.16 in the browser). Solo play needs none of it: without a server the game runs exactly as before, and a failed connection only shows a message in the **Online** panel.

- See each other walk, run and fly: other players are articulated ASCII runners with deterministic headwear and skin variations, a ring in their colour and a floating name tag, smoothly interpolated (12 Hz updates, buffered ~160 ms, drawn every frame). Players in a car, taxi or sky taxi are shown in it, and their cars light the street with headlights.
- Ground cars publish their physical chassis position rather than the driver's camera. Nearby remote cars block local walking, manual driving and street arrivals, and local traffic queues behind them. This remains client-side collision, not server-authoritative vehicle physics.
- Room chat (**Enter**), with join / leave notices. The server limits messages to 200 characters and a burst of 5 (then one every 1.5 s) and strips invisible/control characters; messages are always rendered as text.
- Shared interiors: friends in the same venue see one another and appear on its floorplan. Players outside see a visitor's venue name and doorway position on the city map. Chat and shared map pins work across the room; RPG quest progress, inventory and rewards remain individual.
- A room clock synchronizes monorail timetables and crossing signals. Rider positions are interpolated inside their carriage, then attached to the current train, so friends do not lag behind it. Paused riders travel with their train; renderer recovery restores their carriage position. Civilian routes and traffic vehicles remain local simulations.
- Friends appear on the minimap and atlas. Each player can share up to 24 waypoints with 40-character labels; owners can edit or remove their own pins. Rapid edits converge to the latest label, and leaving or switching rooms clears old shared pins without losing your local ones.
- Movement is client-driven but the server clamps positions to the city, rejects impossible speeds per mode, and allows one instant jump (atlas travel, taxis, station visits) every 1.5 s.

### Host a game

```powershell
npm run dev       # the city, http://127.0.0.1:3000
npm run server    # the multiplayer server, ws://localhost:2567 (open http://localhost:2567 to check it is up)
```

Click **Online** in the header, enter a display name and **Create room**. The five-character room code appears; **Copy invite** copies a message with the code and a link. On the same PC or your LAN (e.g. `http://192.168.1.20:3000`, started with `npx next dev --hostname 0.0.0.0`) the game finds the server on port 2567 of the same host automatically.

### Invite friends over the internet (tunnels)

Your friends need to reach two things on your PC: the website (port 3000) and the multiplayer server (port 2567). Browsers cannot reliably proxy the game's WebSocket through the Next.js dev server, so give each its own tunnel. Both tunnels support WebSockets out of the box.

**Cloudflare Tunnel** (free, no account needed for quick tunnels; install with `winget install --id Cloudflare.cloudflared`), in two terminals:

```powershell
cloudflared tunnel --url http://localhost:3000    # prints https://<site>.trycloudflare.com
cloudflared tunnel --url http://localhost:2567    # prints https://<server>.trycloudflare.com
```

**ngrok** (`winget install ngrok.ngrok`, then `ngrok config add-authtoken <token>`), in two terminals (or both in one `ngrok.yml`):

```powershell
ngrok http 3000     # https://<site>.ngrok-free.app
ngrok http 2567     # https://<server>.ngrok-free.app
```

Then open the **site** tunnel URL yourself, click **Online**, paste the **server** tunnel URL into **Server address** (`https://…` or `wss://…` both work; it is remembered in this browser) and create a room. **Copy invite** produces a link like `https://<site>.trycloudflare.com/?room=K7QX2&server=wss%3A%2F%2F<server>.trycloudflare.com` which opens the Online panel with everything filled in; your friends only type a name and press **Join room**. (The client sends ngrok's `ngrok-skip-browser-warning` header, so ngrok's free-tier warning page does not get in the way.)

Alternatively, tunnel only the server and set the address once for every visitor: create `.env.local` with `NEXT_PUBLIC_MULTIPLAYER_URL=wss://<server>.trycloudflare.com` and restart `npm run dev` (Next.js inlines `NEXT_PUBLIC_*` values when it starts or builds).

| Variable | Where | Default | Meaning |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_MULTIPLAYER_URL` | Next.js (`.env.local`) | unset | Server address offered in the Online panel. Without it: `?server=` from an invite, then the last address used in this browser, then port 2567 on the page's own host when that host is local/LAN. |
| `PORT` | `npm run server` | `2567` | Server port. |
| `HOST` | `npm run server` | `0.0.0.0` | Interface to listen on. |
| `ALLOWED_ORIGINS` | `npm run server` | unset (any) | Comma-separated page origins allowed to connect, e.g. `https://city.trycloudflare.com,http://127.0.0.1:3000`. Quick-tunnel URLs change on every run, so it is off by default; room codes are the only gate. |

In PowerShell, set a server variable for one run with `$env:PORT = "2600"; npm run server`. Rooms hold up to eight players and close when the last player leaves (the party's quest progress closes with them). Quick tunnels are public URLs: share them only with people you want to play with.

## Rendering

The city uses textmode's native geometry, perspective camera, depth buffer, glyph atlas, and GPU materials. A deterministic world model and simple collision controller provide gameplay; there is no separate 3D engine.

- **Real ASCII only.** The glyph atlas is generated at start-up at the exact device cell size: printable ASCII in a bold and a thin weight, rasterised from 8x8 bitmaps at whole-pixel scales (`atlas.ts`, `glyph-font.ts`), so characters are always crisp. Performance / Balanced / Fine use 16 / 12 / 8 CSS px cells.
- One native material (`materials.ts`) decides every cell's character and colours. Tone lives in the cell colour so buildings read as solid masses; characters carry structure: slash, dash and pipe strokes that follow each face's perspective and turn at corners, bold outlines on every edge, bracketed lit windows filled with dense letters, points of light for distant windows, per-family wall textures.
- Text is rendered by the material from a font/message texture: signs animate (buzz, marquee, power-up sweeps), ticker bands scroll around all four faces of a tower, and holograms project a giant bust or koi with a crawling slogan. Letters are real characters when small, a 3x5 block face at mid distance, and ASCII-art letters built from themselves up close.
- Fog uses the sky colour of the same direction and reaches it exactly at the eased draw distance, so buildings emerge from and dissolve into the haze. Props dissolve over the last quarter of their draw distance (carried in the cell alpha); building details retract instead of popping. The scene fades in on start.
- Turning renders at whole-cell yaw/pitch steps so characters re-sample only once per cell of rotation; the `view-warp` filter then re-projects the image by the sub-cell remainder (an exact rotation homography, each character cell moved rigidly), so the centre and the periphery glide at their true perspective speeds (`view-warp.ts`). Debug with `?warp=offset` (the old uniform slide), `?warp=identity` or `?warp=none` (no snapping).

### Motion comfort

First-person ASCII is a lot of high-contrast optic flow, so the renderer is tuned not to make people dizzy:

- **Even frame pacing.** The frame loop measures the display's refresh rate and renders on every k-th vsync (72 fps on 144 Hz, 60 on 120 Hz, capped at 100 fps; 62 on phones) instead of textmode's average-rate limiter, which judders on high-refresh displays (`frame-pacing.ts`).
- **No turning judder.** The old sub-cell slide was exact only at the screen centre and had the pitch correction reversed: looking up or down made the whole image creep the wrong way and snap back every cell, and the edges jumped on every turn. The view-warp filter replaces it.
- **Calmer movement.** Walking 6 m/s and sprinting 11 m/s (were 8 / 18), with movement and flight input easing in and out over ~0.1 s instead of starting and stopping dead. Field of view 62° vertical (~94° horizontal at 16:9).
- **Calmer driving camera.** The camera is rigidly attached to the car: no road shake, head wobble, impact bump, pitch lean or FOV change with speed or boost. Cockpit / chase switches ease over 0.4 s.
- **Quieter texture, crisp structure.** Wall, road and roof textures have a low ink/paper contrast (lowest far away and on the ground, which streams past fastest), while outlines, windows and signs keep theirs, so glyphs that change under motion change little brightness.
- **No strobing.** Failing-tube signs dip to 60 % in slow stutters, sign sweeps end in a ~1 Hz pulse (was a 3 Hz on/off blink), hologram glitches are rare and small, and rain streaks, splashes and puddle ripples are fainter and sparser. The far rain sheet turns with the world instead of sliding at a fifth of its speed.
- Materials add point lighting, projected car headlights and tail lights (with beams scattered in the rain), hard light occlusion, contact shading, height fog and lamp-cone scattering. A reflected camera renders the same native glyph/ink/paper attachments for road puddles.
- `textmode.synth.js` renders one broadcast feed reused by screens and holograms; `textmode.filters.js` runs a tight neon glow and vignette.
- Static building parts are cached and instanced into textmode's native framebuffer through WebGL2. A shared GPU data texture carries lights, occluders, cars and the glyph table.
- Movement stays outside React's render cycle. HUD snapshots update roughly six times per second. Resources and listeners are released on unmount, and hidden tabs suspend rendering.

Performance depends on the device. The browser smoke check forces software rendering for repeatability; its frame rate does not represent hardware-accelerated play. Use **Settings → Detail level → Performance** on slower devices, or **Auto** (the default on phones), which adapts to the measured frame time.

## Checks

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

Tests cover world generation, road and pavement connectivity, collision, camera input, taxi routes, safe landing, continuous train motion, rail viaduct supports kept off carriageways, crossings, lamps, parking spaces and walking lines, station door timing, carriage aisles, complete commuter routines, crossing clearance, traffic and conservative visibility, plus the radio station list, preference parsing and metadata parsing, and multiplayer interpolation, chat sanitising and rate limits, movement checks, party quest reconciliation and an in-process Colyseus server test with two real clients, plus the waypoint store (sharing, remote validation, limits, persistence) and `?wp=` link parsing.

With the app running, `npm run test:browser` checks rendering, populated streets, walking and turning, pause, taxi travel, sky takeoff, station lifts, boarding, walking between carriages, closed-door restrictions, alighting, free flight, settings, mobile layout, and touch movement in an isolated installed Chrome or Edge. It requires no additional package. Pass `-- --gpu` to use hardware acceleration instead of the default software renderer. Screenshots are saved to the ignored `artifacts/` directory. Set `CHROME_PATH` for a different Chromium executable or `CITY_URL` for a different server address.

`npm run test:interiors` checks all six room entrances, walking, exits, pause/resume, car collision and entry/exit, safe street arrivals, blocked handoffs, elevated movement, paused monorail attachment and phone layouts; captures close-up NPCs, tyres and both cockpit directions; and records street/interior render-callback timing in `artifacts/interiors/`. It uses hardware acceleration by default (`-- --software` opts out), with the same `CITY_URL` and `CHROME_PATH` overrides. Unit tests also guard room collision, geometry budgets, centred umbrellas, round tyres and rear-cabin sightlines.

`npm run test:living-city` runs the Night Shift manifest and Kiln calibration through real UI interactions, checks one-time rewards, then creates an ephemeral local multiplayer server to verify shared interior avatars, floorplan dots, scope changes and WebGL recovery. Recovery is also exercised with dialogue and inventory open, so stale panels cannot hide the rebuild controls or resume a lost renderer. It uses an isolated browser profile and never touches your real save or public server.

`npm run test:dead-letter` walks the bulletin job through real movement and dialogue choices, wrong-answer retries and normal save/reload checkpoints, then checks its single reward and persistent receipt. Pass `-- --callback` for the alternative ending. Its fresh browser profile leaves your save untouched.

`npm run test:glasshouse` walks the nursery activity through all three physical stations, retryable mistakes and four save/reload checkpoints. It checks the changing floorplan markers, one payout and the final care receipt in an isolated browser profile.

`npm run test:undertone` walks the listening-bar activity through its real stations, explicit choices, retryable mistakes, saved progress and one final payment. Pass `-- --mood=rain` to check the alternative quiet side. Audio and radio preferences remain untouched.

`npm run test:hud` measures actual native text submissions against the visible controls on desktop and three phone layouts, including a boss and equipped firearm. It also checks that studio `clean=1` hides the native HUD; reports and screenshots go to `artifacts/hud/`.

`npm run test:startup` checks actual loading stages, repeated rebuild clicks, context loss before startup finishes, retired shader/atlas promises, radio continuity and loading layouts. It uses an isolated browser profile, deliberately delays or rejects test-only resource requests and verifies that retired renderers cannot allocate more buffers or overwrite the recovery screen.

`npm run test:quest-tracking` checks the ledger with isolated quest fixtures: keyboard selection, responsive controls, focus containment, immediate saving, reload persistence, safe indoor return positions and fallback after completion. It does not replace the real-input activity walkthroughs.

`npm run test:map-destinations` verifies actual quest-giver labels and the six-venue directory: keyboard tracking, private doorway pins, duplicate prevention, desktop/portrait/compact layouts, compass guidance, reload persistence and choosing a destination without leaving the current room.

`npm run test:remote-human` stages four real loopback peers with different headwear for exterior, shared-room, flight and touch-profile captures. `npm run test:remote-vehicles` checks physical car poses at actual lobby joins, camera switches, collision, landing and doorway exits. Both use isolated browsers and ephemeral local servers; neither touches your save or public service.

`npm run test:mobile-chat` checks real local chat delivery, unread state, mobile HUD clearance, keyboard/IME behavior, responsive layouts and the unchanged desktop log. It uses an isolated browser and an ephemeral loopback server, not your public room.

`npm run test:rail` verifies real platform boarding against the shared timetable, a second player in the same carriage, paused riders and idle gait, renderer recovery, and joining a different room while already aboard. Like the living-city check, its server and saves are isolated; screenshots and its report go to `artifacts/shared-rail/`.

## Visual iteration

Open **http://127.0.0.1:3000/?studio=1** for the opt-in scene lab. Seven camera bookmarks cover streets, facades, rooftops, a station and a carriage. Freeze the world, rebuild at a specific clock, advance time, inspect resident counts or copy a camera link. Add `&clean=1` to hide the interface.

With the dev server running:

```powershell
npm run audit:visual
npm run audit:visual -- --views=market,rooftops --out=reference --reference=1
npm run audit:motion -- --path=turn --frames=30 --clip=360,200,720,480
npm run audit:visual -- --views=market,rooftops --out=batched
npm run audit:visual -- --views=glass-office,glass-grazing,glass-warm --clock=4 --out=glass-fine
npm run audit:visual -- --views=glass-office --clock=4 --quality=low --out=glass-low
npm run audit:visual -- --views=park-pond,park-arena --clock=4 --out=park-ground
node scripts/image-diff.mjs artifacts/reference/market.png artifacts/batched/market.png
```

`audit:motion` moves the camera along a scripted path (`walk`, `sprint`, `turn`, `slowturn`, `strafe`, `flight`, `approach`, `micro`, `micropitch`) one exact step per frame and writes an animated GIF, a contact sheet, a motion-compensated shimmer heatmap and metrics (band-local alignment, magnitude-weighted `shimmerEnergy` / `changeEnergy`, and per-strip `strips` / `vertical` image motion that exposes judder; `--query=warp=offset` appends URL parameters) to `artifacts/motion/<path>/`. The visual audit creates full-resolution PNGs, metrics and an HTML comparison gallery in `artifacts/visual-audit/`. Options include `--clock=45`, `--dpr=2`, `--warm=4000`, `--quality=low`, `--mobile`, `--software` and `--out=directory`. The reference switch retains the native box-submission path for validating instancing; both paths use identical geometry and materials. Compare at the same clock, viewport and camera. Frame rates are device-dependent and should be measured with a single browser instance.

`npm run audit:shaders -- --run --compare-specialization --repeat=1` compares the current material with all surfaces enabled against its production shader families on the installed GPU. Both versions use the same source, separating appearance changes from optimization checks. It uses an isolated loopback WebGL2 harness, the installed textmode vertex shader, and the real batch vertices; no app server is needed. Compile/link, first-draw and subsequent draw timings are separate. Deterministic cell-framebuffer samples must match byte-for-byte, including full and touch-first variants. Reports live in `artifacts/shader-startup/`; omit `--run` to only prepare the source manifest. These timings measure driver startup work, not gameplay FPS. Main-pass ground keeps all park features; reflection and prop shaders omit ground-only code, and building batches retain only their actual facade/prop/sign surfaces. `--baseline=<commit> --compare` remains available for historical comparisons, but intentional appearance changes can fail that cross-commit parity check.

## Files

- `src/components/touch-controls.tsx` (+ `.module.css`), `touch-prefs.ts`, `touch-settings.tsx`, `use-mobile-shell.ts` — phone controls, their settings, and the Safari shell (visual viewport, gesture blocking, audio session); `src/app/mobile.css` — phone layout; `src/app/manifest.ts`, `icon.tsx`, `apple-icon.tsx` — Add to Home Screen.
- `src/city/quality-governor.ts`, `device.ts` — render profiles (Auto) with the frame-time governor, device class.

- `src/city/world.ts` — city generation, district data, collision, movement.
- `src/city/engine.ts` — textmode lifecycle, rendering, input, ambience.
- `src/city/locomotion.ts` — camera smoothing, route planning, transportation, safe landing.
- `src/city/people.ts`, `traffic.ts` — stateful resident routines and signal-following traffic.
- `src/city/driving.ts`, `driving-scene.ts` — vehicle model, parked cars and driving camera; car and cockpit drawing.
- `src/city/interiors.ts`, `interior-scene.ts`, `interior-material.ts`, `src/components/interior-map.tsx` — venue selection, entry/exit, room collision, bounded room rendering and floorplans.
- `src/city/human-model.ts`, `umbrella-model.ts`, `vehicle-wheels.ts`, `vehicle-cabin.ts` — shared residents, centred umbrellas, round tyres and rear cockpit geometry.
- `src/city/metro.ts`, `metro-scene.ts` — physical rail service, stations and carriage interiors.
- `src/city/architecture.ts`, `building-batch.ts` — cached building models and GPU instancing.
- `src/city/materials.ts` — native ASCII material shaders.
- `src/city/signage.ts`, `visibility.ts`, `scene-data.ts` — world signage, culling and shared GPU scene data.
- `server/` — the Colyseus multiplayer server (`index.ts` entry, `app.ts` transport and origins, `room.ts` validation and party state, `state.ts` synchronised schema).
- `src/multiplayer/` — client session and interpolation (`session.ts`, `interpolation.ts`), shared protocol and validation (`protocol.ts`), remote-player drawing (`remote-scene.ts`), engine hooks, waypoint sync and the React hook; `src/components/multiplayer-lobby.tsx`, `chat-panel.tsx`, `player-list.tsx`, `friends-map-layer.ts` for the interface.
- `src/components/` — interface, settings, atlas, and minimap; `quest-dialogue.tsx`, `quest-tracker.tsx`, `quest-log.tsx`, `toasts.tsx` and `quest-map-layer.ts` for conversations, the tracked-quest HUD, the quest log, notifications and atlas markers; `radio.tsx` / `radio.module.css` for the radio widget.
- `src/city/waypoints.ts`, `streets.ts`, `waypoint-scene.ts` — the DOM-free waypoint store (pluggable `WaypointSync`, solo echo by default, `?wp=` link parsing), street names, and the 3D waypoint beacons; `src/components/world-map.tsx`, `world-map-render.ts`, `use-world-map.ts`, `use-waypoints.ts`, `waypoint-hud.tsx`, `waypoint-map-layer.ts`, `world-map.module.css` — the city map overlay (ASCII terrain + overlays), non-pausing open/close, waypoint persistence and links, the compass HUD and minimap waypoints.
- `src/audio/radio.ts` — Nightride FM station list, stream and metadata endpoints, stored preferences and the `<audio>` + Web Audio player.

## Upstream

[textmode.js API](https://code.textmode.art/api/) · [Official installation guide](https://code.textmode.art/docs/installation)

Dependency licenses: textmode.js and textmode.filters.js use MIT; textmode.synth.js uses AGPL-3.0. Their license texts are included with the installed packages.
