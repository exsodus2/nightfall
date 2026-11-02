import assert from "node:assert/strict";
import test from "node:test";
import {
  ANIMATION_HZ, COMFORT_HZ, CityEventWatch, EVENT_OFFSET, EVENT_SITES, SATELLITE_SITE, activeEvents, eventAt, eventLevel, eventSlot, scheduledEvents, slotKind,
} from "../src/city/city-events.ts";

const HOUR = 3600;

test("scheduling is a pure function of the scene clock", () => {
  for (let time = 0; time < 2 * HOUR; time += 7.3) assert.deepEqual(activeEvents(time), activeEvents(time), `clock ${time}`);
  // Order of queries does not matter (no hidden state).
  const late = activeEvents(5000), early = activeEvents(400);
  assert.deepEqual(activeEvents(400), early);
  assert.deepEqual(activeEvents(5000), late);
  // Huge shared clocks stay well formed.
  for (const event of scheduledEvents(1.7e9, 1.7e9 + HOUR)) assert.ok(Number.isFinite(event.start) && event.end > event.start);
});

test("the city wakes quietly: nothing runs at the studio clock or before the first slot", () => {
  for (let time = 0; time < EVENT_OFFSET; time += 1) assert.equal(activeEvents(time).length, 0, `clock ${time}`);
});

test("a happening starts every 3-6 minutes and lasts 40-120 s", () => {
  const district = scheduledEvents(0, 6 * HOUR).filter(event => event.district >= 0);
  assert.ok(district.length >= 60, `${district.length} happenings in 6 hours`);
  for (let i = 0; i < district.length; i++) {
    const event = district[i], duration = event.end - event.start;
    assert.ok(duration >= 40 && duration <= 120, `${event.kind} lasts ${duration} s`);
    if (i > 0) {
      const gap = event.start - district[i - 1].start;
      assert.ok(gap >= 180 && gap <= 360, `gap ${gap} s before ${event.kind} at ${event.start}`);
    }
  }
});

test("happenings never overlap in the same district, and never repeat back to back", () => {
  const events = scheduledEvents(0, 12 * HOUR);
  for (let i = 0; i < events.length; i++) for (let j = i + 1; j < events.length && events[j].start < events[i].end; j++) {
    assert.notEqual(events[i].district, events[j].district, `${events[i].kind} and ${events[j].kind} overlap at ${events[j].start}`);
  }
  for (let time = EVENT_OFFSET; time < 6 * HOUR; time += 3) {
    const active = activeEvents(time), districts = active.map(event => event.district);
    assert.equal(new Set(districts).size, districts.length, `clock ${time}`);
    assert.ok(active.filter(event => event.district >= 0).length <= 1, `clock ${time}`);
  }
  for (let k = 1; k < 600; k++) assert.notEqual(slotKind(k), slotKind(k - 1), `slot ${k}`);
});

test("every kind of happening comes round within two hours, and the satellite about every 10 minutes", () => {
  const events = scheduledEvents(0, 2 * HOUR);
  for (const site of EVENT_SITES) assert.ok(events.some(event => event.kind === site.kind), `${site.kind} scheduled`);
  const satellites = scheduledEvents(0, 2 * HOUR).filter(event => event.kind === "satellite");
  assert.ok(satellites.length >= 10 && satellites.length <= 13, `${satellites.length} re-entries`);
  for (const event of satellites) assert.equal(event.end - event.start, SATELLITE_SITE.duration);
});

test("eventAt finds the running happening of a district", () => {
  const event = eventSlot(3), middle = (event.start + event.end) / 2;
  const found = eventAt(middle, event.district);
  assert.ok(found && found.id === event.id && found.kind === event.kind);
  assert.ok(found.progress > 0.45 && found.progress < 0.55);
  assert.equal(eventAt(event.start - 1, event.district)?.id === event.id, false);
});

test("every animation rate is below the comfort limit", () => {
  assert.ok(COMFORT_HZ <= 0.4);
  for (const [name, hz] of Object.entries(ANIMATION_HZ)) assert.ok(hz > 0 && hz < COMFORT_HZ, `${name} runs at ${hz} Hz`);
});

test("happenings bloom and fade smoothly: no brightness steps", () => {
  for (const site of [...EVENT_SITES, SATELLITE_SITE]) {
    assert.ok(site.fade >= 2, `${site.kind} fades over ${site.fade} s`);
    let previous = eventLevel(0, site.duration, site.fade);
    assert.equal(previous, 0, `${site.kind} starts dark`);
    for (let age = 1 / 60; age <= site.duration; age += 1 / 60) {
      const level = eventLevel(age, site.duration, site.fade);
      assert.ok(Math.abs(level - previous) < 0.02, `${site.kind} steps ${Math.abs(level - previous)} at ${age}`);
      previous = level;
    }
    assert.ok(eventLevel(site.duration, site.duration, site.fade) < 1e-9, `${site.kind} ends dark`);
  }
});

test("the watch announces a happening once, only nearby and outdoors", () => {
  const event = scheduledEvents(0, 3 * HOUR).find(item => item.kind === "checkpoint");
  assert.ok(event);
  const watch = new CityEventWatch(), during = event.start + 2;
  assert.equal(watch.update(during, event.x + 1000, event.z, false), null, "far away: silent");
  assert.equal(watch.update(during, event.x, event.z, true), null, "indoors: silent");
  assert.equal(watch.update(during, event.x + 20, event.z, false), event.title);
  assert.equal(watch.update(during + 1, event.x + 20, event.z, false), null, "only once");
  assert.equal(new CityEventWatch().update(event.end - 5, event.x, event.z, false), null, "not in its last seconds");
});
