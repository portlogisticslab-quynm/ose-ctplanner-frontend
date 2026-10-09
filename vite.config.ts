import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: {
    outDir: "dist", sourcemap: false, chunkSizeWarningLimit: 1200,
    rollupOptions: { output: { manualChunks: {
      react: ["react", "react-dom", "react-router-dom", "@tanstack/react-query", "zustand"],
      konva: ["konva", "react-konva"],
      echarts: ["echarts"],
    } } },
  },
  test: { environment: "node" },
} as never);
