import { defineConfig } from 'vite';
import { resolve } from 'path';
import fs from 'fs';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        room: resolve(__dirname, 'room.html'),
        boards: resolve(__dirname, 'boards.html'),
        howItWorks: resolve(__dirname, 'how-it-works.html'),
      },
    },
  },
  plugins: [
    {
      name: 'room-router',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          // Rewrite /room/* to /room.html for SPA-like routing
          if (req.url.startsWith('/room/')) {
            req.url = '/room.html';
          }
          next();
        });
      },
    },
  ],
  appType: 'mpa',
});
