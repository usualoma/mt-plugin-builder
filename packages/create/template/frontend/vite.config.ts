import { defineConfig } from "vite";

export default defineConfig(({ command, mode }) => ({
  build: {
    lib: {
      entry: "src/main.ts",
      fileName: "main",
      formats: ["es"],
    },
    outDir: "dist",
  },
  ...(command === "serve" && mode === "development"
    ? {
        root: "dev",
        publicDir: "dev/public",
      }
    : {}),
}));
