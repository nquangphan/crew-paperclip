import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createUiDevWatchOptions } from "./src/lib/vite-watch";
import { createApiProxy } from "./src/lib/vite-api-proxy";
import { serviceWorkerBuildIdPlugin } from "./src/lib/vite-sw-build-id";
import { readBrowserBuildCommit } from "./src/lib/vite-build-commit";

const apiProxy = createApiProxy();

// PAPERCLIP_UI_BASE lets the stock UI be built for a sub-path (e.g. "/paperclip/") so it can be served
// beside another UI on the same origin. Unset keeps the default root build.
const uiBase = process.env.PAPERCLIP_UI_BASE || "/";

export default defineConfig(({ mode }) => ({
  base: uiBase,
  define: {
    __PAPERCLIP_BUILD_COMMIT__: JSON.stringify(
      readBrowserBuildCommit(__dirname),
    ),
  },
  plugins: [react(), tailwindcss(), serviceWorkerBuildIdPlugin()],
  build: {
    minify: "esbuild",
  },
  esbuild:
    mode === "production"
      ? {
          // React's component trace uses function names. Keep those useful in
          // error reports without publishing source maps or page context.
          keepNames: true,
          drop: ["console", "debugger"],
          legalComments: "none",
        }
      : undefined,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      lexical: path.resolve(__dirname, "./node_modules/lexical/dist/Lexical.mjs"),
    },
  },
  server: {
    port: 5173,
    watch: createUiDevWatchOptions(process.cwd()),
    proxy: apiProxy,
  },
  preview: {
    port: 3101,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: apiProxy,
  },
}));
