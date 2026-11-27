import { defineConfig } from "vite";

export default defineConfig(({ command, isPreview }) => ({
  // GitHub Pages serves the site under /<repo>/; preview must match the built paths
  base: command === "build" || isPreview ? "/kids-dictation-h5/" : "/",
  server: {
    host: true,
    port: 5173,
  },
}));
