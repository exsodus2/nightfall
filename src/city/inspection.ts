export const SCENE_VIEWS = [
  { id: "market", title: "Silk Market · avenue", x: 11.5, z: 77, height: 2.7, yaw: -0.1, pitch: -0.035 },
  { id: "crossing", title: "Crosswalk · traffic & pedestrians", x: -12, z: 12, height: 2.7, yaw: 0.72, pitch: -0.035 },
  { id: "tenements", title: "Backstreets · facade detail", x: -64, z: 150, height: 2.7, yaw: 0.48, pitch: -0.15 },
  { id: "foundry", title: "Foundry · industrial street", x: -448, z: -250, height: 2.7, yaw: -0.36, pitch: -0.12 },
  { id: "rooftops", title: "Skyline · distant detail", x: 85, z: 150, height: 165, yaw: -0.38, pitch: 0.27 },
  { id: "platform", title: "Station · boarding activity", x: 0, z: -320, height: 31.6, yaw: Math.PI / 2, pitch: 0, platform: 1 },
  { id: "carriage", title: "Monorail · occupied interior", x: 0, z: 0, height: 31.25, yaw: 0, pitch: -0.02, train: 0 },
] as const;
export type InspectionCommand = { kind: "view"; id: string } | { kind: "clock"; seconds: number } | { kind: "step"; seconds: number } | { kind: "freeze"; value: boolean } | { kind: "camera"; x: number; z: number; height: number; yaw: number; pitch: number };
