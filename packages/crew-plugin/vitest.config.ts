import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Nạp file .md như chuỗi, giống loader `text` của esbuild trong build.mjs.
const markdownAsText = {
  name: "markdown-as-text",
  transform(_code: string, id: string) {
    if (!id.endsWith(".md")) return null;
    return { code: `export default ${JSON.stringify(readFileSync(id, "utf8"))};`, map: null };
  },
};

export default {
  root: dirname(fileURLToPath(import.meta.url)),
  plugins: [markdownAsText],
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
  },
};
