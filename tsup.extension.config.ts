import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/extension/background.ts",
    "src/extension/popup.ts",
    "src/extension/content.ts",
  ],
  format: ["esm"],
  target: "chrome120",
  outDir: "dist/extension",
  clean: false, // Don't clean — we copy static files separately
  sourcemap: false,
  dts: false,
  splitting: false,
  noExternal: [/.*/], // Bundle everything (no node_modules in extensions)
});
