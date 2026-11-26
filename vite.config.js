import { defineConfig } from 'vite';

export default defineConfig({
  // relative paths, so the built site works at any address (e.g. GitHub Pages under /wheredoimeetmyhomies/)
  base: './',
  build: { chunkSizeWarningLimit: 2000 },
});
