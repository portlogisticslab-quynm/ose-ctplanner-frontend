import { create } from "zustand";

interface ServerStatus {
  servedBy: string; // home | render | offline
  readOnly: boolean;
  setServedBy: (s: string) => void;
  setReadOnly: (v: boolean) => void;
}

export const useServerStatus = create<ServerStatus>((set) => ({
  servedBy: "home",
  readOnly: false,
  setServedBy: (s) => set((st) => (st.servedBy === s ? st : { servedBy: s, readOnly: s === "render" ? st.readOnly : false })),
  setReadOnly: (v) => set({ readOnly: v }),
}));
