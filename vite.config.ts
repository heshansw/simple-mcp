import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  root: "src/frontend",
  resolve: {
    alias: {
      "@frontend": resolve(__dirname, "src/frontend"),
      "@shared": resolve(__dirname, "src/shared"),
    },
  },
  server: {
    port: 3100,
    proxy: {
      "/api": {
        target: "http://localhost:3101",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: resolve(__dirname, "dist/frontend"),
    emptyOutDir: true,
  },
});
