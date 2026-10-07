// Bundles the Crew plugin into self-contained ESM files, so the Paperclip image does not need
// the dev tsx loader or TypeScript sources of workspace packages to run it.
import { build } from "esbuild";

await build({
  entryPoints: ["src/manifest.ts", "src/worker.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  outdir: "dist",
  logLevel: "warning",
  banner: {
    js: "import { createRequire as __crewCreateRequire } from 'node:module'; const require = __crewCreateRequire(import.meta.url);",
  },
});
