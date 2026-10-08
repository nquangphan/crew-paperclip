import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export default {
  root: dirname(fileURLToPath(import.meta.url)),
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
  },
};
