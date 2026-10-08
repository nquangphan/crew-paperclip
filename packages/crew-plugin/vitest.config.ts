import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export default {
  root: dirname(fileURLToPath(import.meta.url)),
  test: {
    include: ["src/__tests__/*.test.ts", "src/ui/map/*.test.ts"],
    environment: "node",
  },
};
