import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  // GitHub Pages serves the site under /<repo>/
  base: command === "build" ? "/kids-dictation-h5/" : "/",
  server: {
    host: true,
    port: 5173,
  },
}));
