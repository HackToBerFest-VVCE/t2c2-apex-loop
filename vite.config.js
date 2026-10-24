import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/** Serves every /api/* route during `npm run dev`, mirroring the Vercel functions in api/. */
function localApi() {
  return {
    name: 'civiclens-local-api',
    async configureServer(server) {
      // Imported here (after env is loaded) so server modules see the .env values.
      const { ROUTES } = await import('./server/routes.js');
      const { toNode } = await import('./server/http.js');
      const handlers = Object.fromEntries(Object.entries(ROUTES).map(([path, h]) => [path, toNode(h)]));
      server.middlewares.use((req, res, next) => {
        const path = req.url.split('?')[0];
        const handler = handlers[path];
        if (!handler) return next();
        handler(req, res);
      });
    },
  };
}

// Server-only secrets (no VITE_ prefix) are copied from .env into process.env for the local API.
const SERVER_ENV = [
  'GEMINI_API_KEY',
  'GROQ_API_KEY',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'SESSION_SECRET',
  'DATABASE_URL',
  'ADMIN_EMAILS',
];

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Re-read on every (re)start so an edited .env takes effect without restarting the terminal.
  for (const name of [...SERVER_ENV, 'VITE_GOOGLE_CLIENT_ID']) {
    if (env[name]) process.env[name] = env[name].trim();
  }
  return {
    plugins: [react(), localApi()],
    server: { port: 5173, host: true },
  };
});
