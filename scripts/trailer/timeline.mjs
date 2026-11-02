// The cut: one source of truth for picture, titles and score. 96 BPM, so a bar is 2.5 s and every
// cut lands on a beat. Times are seconds on the trailer timeline.
export const BPM = 96, BEAT = 60 / BPM, BAR = 4 * BEAT;
export const FPS = 60;
export const DURATION = 84;

// Picture: each clip plays `shot` from its first frame for `dur` seconds starting at `at`. `fadeIn`
// fades up from black, `dissolve` cross-fades from the previous clip (which keeps running underneath).
export const CLIPS = [
  { shot: "s01-market-crane", at: 3.75, dur: 6.25, fadeIn: 1.25 },
  { shot: "s02-holo-globe", at: 10.0, dur: 5.0, dissolve: 0.6 },
  { shot: "s03-neon-aerial", at: 15.0, dur: 5.0, dissolve: 0.6 },
  { shot: "s04-crossing", at: 20.0, dur: 3.75 },
  { shot: "s05-monorail", at: 23.75, dur: 3.75 },
  { shot: "s06-carriage", at: 27.5, dur: 2.5 },
  { shot: "s07-drive", at: 30.0, dur: 3.75 },
  { shot: "s08-kiln", at: 33.75, dur: 2.5 },
  { shot: "s09-holo-jelly", at: 36.25, dur: 3.75 },
  { shot: "s10-last-tree", at: 40.0, dur: 3.75 },
  { shot: "s11-memory-gate", at: 43.75, dur: 3.75 },
  { shot: "s12-ember", at: 47.5, dur: 2.5 },
  { shot: "s13-fly-canyon", at: 50.0, dur: 2.5 },
  { shot: "s14-holo-bust", at: 52.5, dur: 2.5 },
  { shot: "s15-skim", at: 55.0, dur: 2.5 },
  { shot: "s16-cockpit", at: 57.5, dur: 1.25 },
  { shot: "s17-silk-air", at: 58.75, dur: 1.25 },
  { shot: "s18-spillway", at: 60.0, dur: 1.25 },
  { shot: "s19-neon-street", at: 61.25, dur: 1.25 },
  { shot: "s20-dive", at: 62.5, dur: 2.5 },
  { shot: "s21-finale", at: 66.25, dur: 9.75, fadeIn: 0.75, fadeOut: 1.25 },
];

// Musical landmarks the score and titles hit.
export const CUE = {
  open: 0, firstShot: 3.75, arp: 10.0, drop: 20.0, rise: 50.0, riserStart: 60.0, blackout: 65.0,
  finale: 66.25, title: 70.0, endCard: 75.0, end: DURATION,
};
