import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://localhost:8787"
    }
  }
});
