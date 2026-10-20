import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed port and no HMR noise over the Tauri IPC.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 14230, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
  envPrefix: ["VITE_", "TAURI_"],
  build: { target: "es2021", sourcemap: false },
});
