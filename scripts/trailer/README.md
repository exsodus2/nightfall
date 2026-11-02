# Trailer pipeline

Renders the Nightfall trailer from the real game renderer. No dependencies beyond Chrome and ffmpeg (with libx264).
Everything lands in `artifacts/trailer/` (git-ignored).

1. `npm run dev` (the city at http://127.0.0.1:3000)
2. `node --experimental-strip-types scripts/trailer/capture.mjs` captures every shot in `shots.mjs` at 4K60.
   The page runs on a virtual clock (`browser.mjs`), so each frame advances the game by exactly 1/60 s
   however long the capture takes. Use `--only=name,name` to re-shoot, `--stills --dpr=1` to review compositions.
3. `node scripts/trailer/titles.mjs` renders the typography layer (`titles.html`) with alpha.
4. `node scripts/trailer/score.mjs` synthesizes the original score (96 BPM, locked to the cut).
5. `node scripts/trailer/edit.mjs` conforms picture, titles and score into
   `nightfall-trailer-4k.mp4` and `nightfall-trailer-1080p.mp4` (H.264 High, BT.709, AAC 320k, -14 LUFS).
   `--draft` makes a quick 1080p preview.

`timeline.mjs` is the single source of truth for cut points; titles and score follow it.
Helpers: `scout.mjs` (stills from a JSON list of cameras), `sheet.mjs` / `strip.mjs` (contact sheets),
`locate.ts` (hologram and landmark positions from the world data).
