import { useMemo } from "react";
import type { CitySnapshot } from "@/city/engine";
import { facingIn, interiorFixtureLabel, interiorFixtures, interiorLocal, isGroundFloorKind, type InteriorPlace } from "@/city/interiors";
import { INTERIOR_USE_MARKER_RADIUS, interiorMapDescription, interiorUseLabel } from "@/city/interior-map-markers";
import { groundFloorPlan } from "@/city/building-interiors";
import { floorTitle } from "@/city/upper-floors";
import { samePlace } from "@/multiplayer/presence";

export function InteriorMap({ place, snapshot }: { place: InteriorPlace; snapshot: CitySnapshot }) {
  const player = interiorLocal(place, snapshot.x, snapshot.z);
  const heading = snapshot.yaw - facingIn(place);
  const halfWidth = place.width / 2, halfDepth = place.depth / 2;
  const markers = snapshot.interiorUseMarkers ?? [], markerHalfSize = INTERIOR_USE_MARKER_RADIUS - 0.07;
  // Ground floors can hold dozens of fixtures: build them (and the room labels) once per visit, not per snapshot.
  const fixtures = useMemo(() => interiorFixtures(place), [place]);
  const rooms = useMemo(() => isGroundFloorKind(place.kind) ? groundFloorPlan(place).rooms : [], [place]);
  return <svg viewBox={`${-halfWidth - 1} ${-halfDepth - 1} ${place.width + 2} ${place.depth + 3}`} role="img" aria-label={`${place.name} floor plan`} aria-describedby="interior-map-description" preserveAspectRatio="xMidYMid meet" style={{ display: "block", width: "100%", aspectRatio: "1", background: "#09151b" }}>{/* Same footprint as the street minimap whatever the room's depth, so the radio above never overlaps it. */}
    <desc id="interior-map-description">{interiorMapDescription(place, markers)}</desc>
    <rect x={-halfWidth} y={-halfDepth} width={place.width} height={place.depth} fill="#142630" stroke="#5d7b87" strokeWidth="0.12" />
    {rooms.map((room, index) => room.label ? <text key={`room-${index}`} data-interior-room={room.label} x={room.x} y={room.z + 0.3} fill="#4f6c78" fontSize="0.8" fontFamily="monospace" textAnchor="middle" aria-hidden="true">{room.label.toUpperCase()}</text> : null)}
    {fixtures.map((fixture, index) => fixture.kind === "wall" ? <rect key={index} x={fixture.x - fixture.width / 2} y={fixture.z - fixture.depth / 2} width={fixture.width} height={fixture.depth} fill="#5d7b87" /> : <rect key={index} x={fixture.x - fixture.width / 2} y={fixture.z - fixture.depth / 2} width={fixture.width} height={fixture.depth} fill="#34515d" stroke="#75929c" strokeWidth="0.08" />)}
    {fixtures.map((fixture, index) => {
      const label = interiorFixtureLabel(place, fixture);
      return label ? <text key={`label-${index}`} data-interior-label={label.text} x={label.x} y={label.z + 0.25} fill="#9fc3cc" fontSize="0.7" fontFamily="monospace" textAnchor="middle" aria-hidden="true">{label.text}</text> : null;
    })}
    {place.floor ? null : <path d={`M -1.5 ${halfDepth} h 3`} fill="none" stroke="#ffd28c" strokeWidth="0.4" />}
    {/* Upper floors: no street door, the lift is the way down; the floor's name in the corner. */}
    <text x="0" y={halfDepth + 1.35} fill="#ffd28c" fontSize="0.9" fontFamily="monospace" textAnchor="middle">{place.floor ? "LIFT" : "EXIT"}</text>
    {place.stops ? <text data-interior-floor={place.floor ?? 1} x={halfWidth - 0.3} y={halfDepth + 1.35} fill="#9fc3cc" fontSize="0.9" fontFamily="monospace" textAnchor="end">{floorTitle(place).toUpperCase()}</text> : null}
    {markers.length ? <text x={-halfWidth + 0.3} y={halfDepth + 1.35} fill="#ffd28c" fontSize="0.9" fontFamily="monospace">USE</text> : null}
    {markers.map(marker => <g key={marker.id} data-interior-use={marker.id} transform={`translate(${marker.x} ${marker.z})`} role="img" aria-label={interiorUseLabel(place, marker)}>
      <title>{interiorUseLabel(place, marker)}</title>
      <rect x={-markerHalfSize} y={-markerHalfSize} width={markerHalfSize * 2} height={markerHalfSize * 2} fill="#09151b" stroke="#ffd28c" strokeWidth="0.14" />
      <text x="0" y="0.47" fill="#ffd28c" fontSize="1.4" fontFamily="monospace" textAnchor="middle" aria-hidden="true">{marker.glyph}</text>
    </g>)}
    {(snapshot.friends ?? []).filter(friend => samePlace(friend.place, place.id)).map(friend => {
      const position = interiorLocal(place, friend.x, friend.z);
      return <circle key={friend.id} data-interior-friend={friend.id} cx={position.x} cy={position.z} r="0.4" fill={friend.color} stroke="#09151b" strokeWidth="0.1"><title>{friend.name}</title></circle>;
    })}
    <line x1={player.x} y1={player.z} x2={player.x + Math.sin(heading) * 1.6} y2={player.z - Math.cos(heading) * 1.6} stroke="#b7fff1" strokeWidth="0.15" />
    <circle data-interior-player="true" cx={player.x} cy={player.z} r="0.4" fill="#b7fff1" stroke="#09211f" strokeWidth="0.1" />
  </svg>;
}
