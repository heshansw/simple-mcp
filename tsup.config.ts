import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  dts: false,
  splitting: false,
  // Don't bundle node_modules — they're always present at runtime
  // Bundling CJS deps into ESM causes "Dynamic require" errors
  external: [/node_modules/],
});
