import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  outDir: "dist",
  clean: true,
  sourcemap: true,
  target: "es2022",
  // @repo/db exports TypeScript source, so bundle workspace packages rather
  // than externalizing them (npm deps stay external).
  noExternal: [/^@repo\//],
});
