import { create } from "zustand";
import {
  Room,
  ServerMessage,
  AgentState,
  RoomState,
  NetworkLink,
} from "../types";

interface SimulationState {
  agents: AgentState[];
  rooms: RoomState[];
  logs: ServerMessage[];
  relationships: NetworkLink[];
  selectedAgent: string | null;
  selectedRoom: string | null;
  isAutoScan: boolean;
  isRunning: boolean;
  
  // Actions
  setAgents: (agents: AgentState[]) => void;
  setRooms: (rooms: RoomState[]) => void;
  setRelationships: (relationships: NetworkLink[]) => void;
  addLog: (log: ServerMessage) => void;
  clearLogs: () => void;
  setSelectedAgent: (id: string | null) => void;
  setSelectedRoom: (room: string | null) => void;
  setIsRunning: (isRunning: boolean) => void;
  setIsAutoScan: (isAuto: boolean) => void;
}

export const useSimulationStore = create<SimulationState>((set, get) => ({
  agents: [],
  rooms: [],
  logs: [],
  relationships: [],
  selectedAgent: null,
  selectedRoom: null,
  isRunning: false,
  isAutoScan: false,

  setAgents: (agents) =>
    set({
      agents: typeof agents === "function" ? agents(get().agents) : agents,
    }),
  setRooms: (rooms) =>
    set({
      rooms: typeof rooms === "function" ? rooms(get().rooms || []) : rooms,
    }),
  setRelationships: (relationships) => set({ relationships }),
  addLog: (log) => set((state) => ({ logs: [...state.logs, log] })),
  clearLogs: () => set({ logs: [] }),
  setSelectedAgent: (agent) => set({ selectedAgent: agent }),
  setSelectedRoom: (room) => set({ selectedRoom: room }),
  setIsRunning: (isRunning) => set({ isRunning }),
  setIsAutoScan: (isAutoScan) => set({ isAutoScan }),
}));
