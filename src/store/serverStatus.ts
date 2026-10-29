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
  // V1.4.2: a response from the main server also clears a read-only flag left by an earlier READ_ONLY_BACKUP answer
  // (before, the flag was cleared only when servedBy changed, so it could stay on for the whole session)
  setServedBy: (s) => set((st) => {
    const readOnly = s === "render" ? st.readOnly : false;
    return st.servedBy === s && st.readOnly === readOnly ? st : { servedBy: s, readOnly };
  }),
  setReadOnly: (v) => set({ readOnly: v }),
}));
