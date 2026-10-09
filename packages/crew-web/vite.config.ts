import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

function crewUiCommit(): Plugin {
  return {
    name: 'crew-ui-commit',
    transformIndexHtml(html, ctx) {
      const commit = process.env.CREW_UI_COMMIT ?? '';
      if (!ctx.server && !/^[0-9a-f]{40}$/.test(commit)) {
        throw new Error('CREW_UI_COMMIT phải là commit 40 hex khi build');
      }
      return html.replace('%CREW_UI_COMMIT%', commit || 'dev');
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), crewUiCommit()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  server: {
    port: 5183,
    proxy: {
      '/api': {
        target: process.env.CREW_WEB_API ?? 'http://127.0.0.1:3199',
        ws: true,
        changeOrigin: false,
      },
    },
  },
});
