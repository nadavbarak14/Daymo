import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  build: { outDir: "../dist/editor-ui", emptyOutDir: true },
  server: { proxy: { "/api": "http://localhost:12345", "/captures": "http://localhost:12345" } },
});
