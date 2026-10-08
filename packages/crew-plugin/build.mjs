// Bundles the Crew plugin into self-contained ESM files, so the Paperclip image does not need
// the dev tsx loader or TypeScript sources of workspace packages to run it.
import { build } from "esbuild";

const pluginUiRequireBridge = {
  name: "crew-plugin-ui-require-bridge",
  setup(build) {
    build.onResolve({ filter: /^(react|react-dom|react\/jsx-runtime)$/ }, (args) => {
      if (args.kind !== "require-call") return undefined;
      return { path: args.path, namespace: "crew-plugin-ui-require-bridge" };
    });

    build.onLoad({ filter: /.*/, namespace: "crew-plugin-ui-require-bridge" }, (args) => {
      const bridgeKey = {
        react: "react",
        "react-dom": "reactDom",
        "react/jsx-runtime": "reactJsxRuntime",
      }[args.path];

      return {
        contents: `
          const bridge = globalThis.__paperclipPluginBridge__;
          if (!bridge || !bridge.${bridgeKey}) {
            throw new Error("Paperclip plugin ${args.path} require shim: host bridge is not initialized (expected __paperclipPluginBridge__.${bridgeKey}).");
          }
          module.exports = bridge.${bridgeKey};
        `,
        loader: "js",
      };
    });
  },
};

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

await build({
  entryPoints: ["src/ui/index.tsx"],
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2022",
  outfile: "dist/ui/index.js",
  external: ["react", "react-dom", "react/jsx-runtime", "@paperclipai/plugin-sdk/ui"],
  plugins: [pluginUiRequireBridge],
  loader: { ".css": "text" },
  logLevel: "warning",
});
