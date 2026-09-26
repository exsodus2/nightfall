import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_RADIO_PREFS, RADIO_STATIONS, binsToBands, cycleStation, formatNowPlaying, meterString, parseMetadata, parseRadioPrefs,
  stationLabel, stepVolume, streamUrl, volumeBar,
} from "../src/audio/radio.ts";

test("station list covers the Nightride channels with unique ids and HTTPS streams", () => {
  const ids = RADIO_STATIONS.map((station) => station.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ["nightride", "chillsynth", "datawave", "spacesynth", "darksynth", "horrorsynth", "ebsm"]) assert.ok(ids.includes(id), id);
  assert.equal(streamUrl(RADIO_STATIONS[0]), "https://stream.nightride.fm/nightride.mp3");
  assert.equal(stationLabel(RADIO_STATIONS.find((station) => station.id === "darksynth")!), "NIGHTRIDE FM // DARKSYNTH");
});

test("station cycling wraps both ways and tolerates unknown ids", () => {
  const last = RADIO_STATIONS[RADIO_STATIONS.length - 1].id;
  assert.equal(cycleStation("nightride", 1), RADIO_STATIONS[1].id);
  assert.equal(cycleStation("nightride", -1), last);
  assert.equal(cycleStation(last, 1), "nightride");
  assert.equal(cycleStation("gone", 1), RADIO_STATIONS[1].id);
});

test("volume steps stay on a 5% grid inside [0, 1]", () => {
  assert.equal(stepVolume(0.6, 0.05), 0.65);
  assert.equal(stepVolume(0.98, 0.05), 1);
  assert.equal(stepVolume(0.02, -0.05), 0);
  let volume = 0.5;
  for (let i = 0; i < 7; i++) volume = stepVolume(volume, 0.05);
  assert.equal(volume, 0.85);
});

test("stored preferences are validated field by field", () => {
  assert.deepEqual(parseRadioPrefs(null), DEFAULT_RADIO_PREFS);
  assert.deepEqual(parseRadioPrefs("{not json"), DEFAULT_RADIO_PREFS);
  assert.deepEqual(parseRadioPrefs("[]"), DEFAULT_RADIO_PREFS);
  assert.deepEqual(parseRadioPrefs(JSON.stringify({ station: "ebsm", volume: 0.33, muted: true, on: true, pauseHidden: true })), { station: "ebsm", volume: 0.35, muted: true, on: true, pauseHidden: true });
  assert.deepEqual(parseRadioPrefs(JSON.stringify({ station: "pirate", volume: 7, muted: "yes" })), { ...DEFAULT_RADIO_PREFS, volume: 1 });
});

test("metadata feed messages parse, keepalives are ignored", () => {
  assert.equal(parseMetadata("keepalive"), null);
  assert.equal(parseMetadata("{}"), null);
  const meta = parseMetadata(JSON.stringify([
    { station: "darksynth", title: "We Detach", artist: "DEADLIFE", track_id: "x" },
    { station: "nightride", title: "Kaneda's Theme", artist: "The State of Synth Live", dj: "tsos" },
    { title: "no station" },
  ]));
  assert.ok(meta);
  assert.equal(meta.size, 2);
  assert.deepEqual(meta.get("darksynth"), { artist: "DEADLIFE", title: "We Detach", live: false });
  assert.equal(meta.get("nightride")?.live, true);
  assert.equal(formatNowPlaying(meta.get("darksynth")), "DEADLIFE — We Detach");
  assert.equal(formatNowPlaying({ artist: "", title: "Only title", live: false }), "Only title");
  assert.equal(formatNowPlaying(undefined), "");
});

test("meter and volume glyphs", () => {
  assert.equal(meterString([0, 0.5, 1, 2, -1]), " ▄██ ");
  assert.equal(volumeBar(0.6, false), "▮▮▮▮▮▮▯▯▯▯");
  assert.equal(volumeBar(0.6, true), "▯▯▯▯▯▯▯▯▯▯");
  const bands = new Float32Array(8);
  binsToBands(new Uint8Array(128).fill(255), bands);
  assert.ok(bands.every((level) => level === 1));
  binsToBands(new Uint8Array(128), bands);
  assert.ok(bands.every((level) => level === 0));
});
