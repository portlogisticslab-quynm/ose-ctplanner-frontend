// Editor document (objects + road graph) with undo/redo (snapshot stack, max 100 steps).
import { create } from "zustand";
import type { LayoutObject, RoadGraph } from "../api/types";

const MAX = 100;

export interface Doc {
  objects: LayoutObject[];
  road: RoadGraph;
}

const EMPTY_ROAD: RoadGraph = { nodes: [], edges: [] };

interface HistoryState extends Doc {
  past: Doc[];
  future: Doc[];
  dirty: boolean;
  reset: (objects: LayoutObject[], road?: RoadGraph | null) => void;
  commit: (objects: LayoutObject[], road?: RoadGraph) => void;
  undo: () => void;
  redo: () => void;
  markSaved: () => void;
}

export const useHistory = create<HistoryState>((set) => ({
  objects: [],
  road: EMPTY_ROAD,
  past: [],
  future: [],
  dirty: false,
  reset: (objects, road) => set({ objects, road: road ?? EMPTY_ROAD, past: [], future: [], dirty: false }),
  commit: (objects, road) => set((s) => ({
    objects, road: road ?? s.road,
    past: [...s.past, { objects: s.objects, road: s.road }].slice(-MAX), future: [], dirty: true,
  })),
  undo: () => set((s) => {
    if (!s.past.length) return s;
    const prev = s.past[s.past.length - 1];
    return { ...prev, past: s.past.slice(0, -1), future: [{ objects: s.objects, road: s.road }, ...s.future], dirty: true };
  }),
  redo: () => set((s) => {
    if (!s.future.length) return s;
    const [next, ...rest] = s.future;
    return { ...next, past: [...s.past, { objects: s.objects, road: s.road }], future: rest, dirty: true };
  }),
  markSaved: () => set({ dirty: false }),
}));
