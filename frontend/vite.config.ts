import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 15173,
    proxy: {
      "/api": "http://127.0.0.1:13080",
      "/health": "http://127.0.0.1:13080"
    }
  },
  preview: {
    host: "127.0.0.1",
    port: 15174
  }
});
