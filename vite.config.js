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
        // Clean-URL routing in dev, mirroring vercel.json (cleanUrls + the
        // /room/:id rewrite) so `npm run dev` matches production exactly.
        const cleanRoutes = {
          '/how-it-works': '/how-it-works.html',
          '/boards': '/boards.html',
        };
        server.middlewares.use((req, res, next) => {
          const path = req.url.split('?')[0];
          if (path.startsWith('/room/')) {
            req.url = '/room.html';
          } else if (cleanRoutes[path]) {
            req.url = cleanRoutes[path];
          }
          next();
        });
      },
    },
  ],
  appType: 'mpa',
});
