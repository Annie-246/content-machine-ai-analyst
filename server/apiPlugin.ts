import type { Plugin } from 'vite';
import {
  handleFetchVideo, handleFetchSource, handleLlm, handleGemini, sendJson,
  applyCors, checkAccess, handlePreflight, serverInfo,
  handleRadarSearch, handleRadarCreators, handleRadarCreatorVideos, handleRadarSuggest,
} from './handlers.mjs';
// Tính năng ảnh nằm ở module riêng để không đụng vào handlers.mjs.
import { handleCarouselRender, handleCarouselHealth } from './carouselRoute.mjs';

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
    server.middlewares.use('/api/fetch-source', guard((req: any, res: any) => handleFetchSource(req, res)));
    server.middlewares.use('/api/llm', guard((req: any, res: any) => handleLlm(req, res)));
    server.middlewares.use('/api/gemini', guard((req: any, res: any) => handleGemini(req, res, fallbackApiKey)));
    server.middlewares.use('/api/radar/search', guard((req: any, res: any) => handleRadarSearch(req, res, fallbackApiKey)));
    server.middlewares.use('/api/radar/suggest-keywords', guard((req: any, res: any) => handleRadarSuggest(req, res, fallbackApiKey)));
    server.middlewares.use('/api/radar/creators', guard(handleRadarCreators));
    server.middlewares.use('/api/radar/creator-videos', guard((req: any, res: any) => handleRadarCreatorVideos(req, res, fallbackApiKey)));
    server.middlewares.use('/api/carousel/render', guard((req: any, res: any) => handleCarouselRender(req, res)));
    server.middlewares.use('/api/carousel/health', guard((req: any, res: any) => handleCarouselHealth(req, res)));
    server.middlewares.use('/api/health', (req: any, res: any) => {
      if (req.method === 'OPTIONS') return handlePreflight(req, res);
      applyCors(req, res);
      sendJson(res, 200, serverInfo());
    });
  },
});
