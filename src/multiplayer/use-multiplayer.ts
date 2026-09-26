"use client";

// React glue for multiplayer: owns the page's MultiplayerSession, attaches it to the engine while
// connected, swaps the waypoint store onto the room, and turns session events into toasts.
import { useCallback, useEffect, useState, useSyncExternalStore, type RefObject } from "react";
import type { CityController } from "@/city/engine";
import { LOCAL_OWNER, cityWaypoints } from "@/city/waypoints";
import { MultiplayerSession, type ConnectRequest, type SessionView } from "./session";
import { createRoomWaypointSync } from "./waypoint-sync";

const SERVER_VIEW: SessionView = { status: "idle", error: null, code: null, serverUrl: null, selfId: null, roster: [], chat: [] };

export interface MultiplayerApi {
  view: SessionView;
  connect: (request: ConnectRequest) => Promise<boolean>;
  leave: () => void;
  sendChat: (text: string) => boolean;
}

export function useMultiplayer(controller: RefObject<CityController | null>, onToast: (message: string) => void): MultiplayerApi {
  const [session] = useState(() => new MultiplayerSession());
  const view = useSyncExternalStore(session.subscribe, session.getView, () => SERVER_VIEW);
  const connected = view.status === "connected";

  // The engine reads poses / remote players / party quests through the link only while connected.
  useEffect(() => {
    const city = controller.current;
    if (!connected || !city) return;
    city.setMultiplayer(session);
    return () => city.setMultiplayer(null);
  }, [connected, controller, session]);

  // Shared waypoints go through the room while connected; the store falls back to solo afterwards.
  useEffect(() => {
    if (!connected || !view.selfId) return;
    cityWaypoints.setOwner(view.selfId);
    const disconnect = cityWaypoints.connect(createRoomWaypointSync(session));
    return () => { disconnect(); cityWaypoints.setOwner(LOCAL_OWNER); };
  }, [connected, view.selfId, session]);

  useEffect(() => session.onEvent((event) => onToast(event.text)), [session, onToast]);
  useEffect(() => () => { void session.leave(); }, [session]);

  const connect = useCallback((request: ConnectRequest) => session.connect(request), [session]);
  const leave = useCallback(() => { void session.leave(); }, [session]);
  const sendChat = useCallback((text: string) => session.sendChat(text), [session]);
  return { view, connect, leave, sendChat };
}
