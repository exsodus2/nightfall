// Prints aim points for trailer shots, computed from the deterministic world:
//   node --experimental-strip-types scripts/trailer/locate.ts
import { CityWorld, LANDMARKS, DISTRICTS } from "../../src/city/world.ts";
const world = new CityWorld();
const holos = world.buildings.filter(b => b.id % 11 === 0 && b.height >= 70).map(b => {
  const bx = ((b.x % 64) + 64) % 64, sx = bx < 32 ? -1 : 1;
  const face = { x: b.x + sx * (b.width / 2 + 0.28), z: b.z, yaw: sx * 90 };
  const a = face.yaw * Math.PI / 180;
  return { id: b.id, district: DISTRICTS[b.district].name, x: +(face.x + Math.sin(a) * 7).toFixed(1), y: +(b.height * 0.62).toFixed(1), z: +(face.z + Math.cos(a) * 7).toFixed(1), face: face.yaw, h: Math.round(b.height), size: 10 + (b.id % 3) * 3 };
});
console.log("holograms", holos.length);
for (const h of holos.sort((p, q) => Math.hypot(p.x, p.z + 160) - Math.hypot(q.x, q.z + 160)).slice(0, 25)) console.log(JSON.stringify(h));
console.log("tallest", world.buildings.slice().sort((a, b) => b.height - a.height).slice(0, 8).map(b => `${b.id}@${b.x.toFixed(0)},${b.z.toFixed(0)} h${b.height.toFixed(0)} ${DISTRICTS[b.district].name}`).join("\n"));
for (const l of LANDMARKS) console.log(l.id, l.x, l.z, "arrival", l.arrivalX, l.arrivalZ);
