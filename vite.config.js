import { defineConfig, loadEnv } from 'vite';
import { recommendHandler } from './server/recommend.js';

export default defineConfig(({ mode }) => {
  // Make ANTHROPIC_API_KEY from .env visible to the server-side handler only.
  const env = loadEnv(mode, process.cwd(), '');
  if (env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;

  // Must not return anything: Vite calls a returned function as a post-hook.
  const api = (server) => { server.middlewares.use('/api/recommend', recommendHandler); };
  return {
    plugins: [{ name: 'recommend-api', configureServer: api, configurePreviewServer: api }],
    build: { chunkSizeWarningLimit: 2000 },
  };
});
