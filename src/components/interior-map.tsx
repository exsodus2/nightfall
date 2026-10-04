import type { CitySnapshot } from "@/city/engine";
import { interiorFixtures, interiorLocal, type InteriorPlace } from "@/city/interiors";
import { samePlace } from "@/multiplayer/presence";

export function InteriorMap({ place, snapshot }: { place: InteriorPlace; snapshot: CitySnapshot }) {
  const player = interiorLocal(place, snapshot.x, snapshot.z);
  const heading = snapshot.yaw - place.yaw;
  const halfWidth = place.width / 2, halfDepth = place.depth / 2;
  return <svg viewBox={`${-halfWidth - 1} ${-halfDepth - 1} ${place.width + 2} ${place.depth + 3}`} role="img" aria-label={`${place.name} floor plan. The exit is at the bottom.`} style={{ display: "block", width: "100%", height: "100%", background: "#09151b" }}>
    <rect x={-halfWidth} y={-halfDepth} width={place.width} height={place.depth} fill="#142630" stroke="#5d7b87" strokeWidth="0.12" />
    {interiorFixtures(place).map((fixture, index) => <rect key={index} x={fixture.x - fixture.width / 2} y={fixture.z - fixture.depth / 2} width={fixture.width} height={fixture.depth} fill="#34515d" stroke="#75929c" strokeWidth="0.08" />)}
    <path d={`M -1.5 ${halfDepth} h 3`} fill="none" stroke="#ffd28c" strokeWidth="0.4" />
    <text x="0" y={halfDepth + 1.35} fill="#ffd28c" fontSize="0.9" fontFamily="monospace" textAnchor="middle">EXIT</text>
    {(snapshot.friends ?? []).filter(friend => samePlace(friend.place, place.id)).map(friend => {
      const position = interiorLocal(place, friend.x, friend.z);
      return <circle key={friend.id} cx={position.x} cy={position.z} r="0.4" fill={friend.color} stroke="#09151b" strokeWidth="0.1"><title>{friend.name}</title></circle>;
    })}
    <line x1={player.x} y1={player.z} x2={player.x + Math.sin(heading) * 1.6} y2={player.z - Math.cos(heading) * 1.6} stroke="#b7fff1" strokeWidth="0.15" />
    <circle cx={player.x} cy={player.z} r="0.4" fill="#b7fff1" stroke="#09211f" strokeWidth="0.1" />
  </svg>;
}
