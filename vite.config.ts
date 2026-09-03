import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { apiPlugin } from './server/apiPlugin';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const apiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY || '';

    // Hand server-only settings from .env.local to the API plugin. These are
    // read through process.env inside server/, never through `define`, so they
    // stay out of the browser bundle.
    for (const key of [
      'YTDLP_PATH', 'YTDLP_COOKIES_FROM_BROWSER', 'YTDLP_COOKIES_FILE', 'FB_COOKIES_FILE',
      'APIFY_API_TOKEN', 'TIKHUB_API_KEY', 'RADAR_DOUYIN_SEARCH_ACTOR', 'RADAR_DOUYIN_PROFILE_ACTOR',
    ]) {
      if (env[key]) process.env[key] = env[key];
    }

    return {
      server: {
        port: 3100,
        host: '0.0.0.0',
      },
      plugins: [react(), tailwindcss(), apiPlugin(apiKey)],
      define: {
        'process.env.API_KEY': JSON.stringify(mode === 'development' ? apiKey : ''),
        'process.env.GEMINI_API_KEY': JSON.stringify(mode === 'development' ? apiKey : ''),
        // Lets a static deploy point at an API server hosted elsewhere.
        'process.env.API_BASE_URL': JSON.stringify(env.API_BASE_URL || '')
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
