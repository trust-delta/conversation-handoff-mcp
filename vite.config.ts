import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const input = process.env.INPUT;

// Only configure build when INPUT is set (for UI building)
// Otherwise return empty config (avoids vitest conflict)
export default defineConfig(
  input
    ? {
        plugins: [viteSingleFile()],
        build: {
          outDir: "dist",
          emptyOutDir: false,
          rollupOptions: {
            input,
          },
        },
      }
    : {}
);
