import type { Plugin } from 'vite';
import {
  handleFetchVideo, handleLlm, handleGemini, sendJson,
  applyCors, checkAccess, handlePreflight, serverInfo,
} from './handlers.mjs';

// Mounts the same handlers the production server uses, so dev and deploy
// behave identically.
export const apiPlugin = (fallbackApiKey: string): Plugin => ({
  name: 'content-machine-api',
  configureServer(server) {
    // Same CORS and token rules as production so both behave alike.
    const guard = (handler) => (req: any, res: any) => {
      if (req.method === 'OPTIONS') return handlePreflight(req, res);
      applyCors(req, res);
      if (!checkAccess(req, res)) return;
      return handler(req, res);
    };

    server.middlewares.use('/api/fetch-video', guard((req: any, res: any) => handleFetchVideo(req, res, fallbackApiKey)));
    server.middlewares.use('/api/llm', guard((req: any, res: any) => handleLlm(req, res)));
    server.middlewares.use('/api/gemini', guard((req: any, res: any) => handleGemini(req, res, fallbackApiKey)));
    server.middlewares.use('/api/health', (req: any, res: any) => {
      if (req.method === 'OPTIONS') return handlePreflight(req, res);
      applyCors(req, res);
      sendJson(res, 200, serverInfo());
    });
  },
});
