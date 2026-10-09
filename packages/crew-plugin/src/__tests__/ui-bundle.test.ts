import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as React from "react";
import * as ReactDom from "react-dom";
import * as ReactJsxRuntime from "react/jsx-runtime";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function dataModule(source: string): string {
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

function bridgeModuleSource(bridgeKey: "react" | "reactDom" | "reactJsxRuntime", module: object): string {
  const names = Object.keys(module).filter((name) => name !== "default" && /^[A-Za-z_$][\w$]*$/.test(name));
  return [
    `const R = globalThis.__paperclipPluginBridge__.${bridgeKey};`,
    "export default R;",
    ...names.map((name) => `export const ${name} = R.${name};`),
  ].join("\n");
}

function hostRewrite(source: string): string {
  const sdkNames = new Set<string>();
  for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']@paperclipai\/plugin-sdk\/ui["']/g)) {
    for (const imported of match[1].split(",")) {
      const name = imported.trim().split(/\s+as\s+/)[0];
      if (/^[A-Za-z_$][\w$]*$/.test(name)) sdkNames.add(name);
    }
  }

  const shims = {
    react: dataModule(bridgeModuleSource("react", React)),
    "react-dom": dataModule(bridgeModuleSource("reactDom", ReactDom)),
    "react/jsx-runtime": dataModule(bridgeModuleSource("reactJsxRuntime", ReactJsxRuntime)),
    "@paperclipai/plugin-sdk/ui": dataModule([...sdkNames].map((name) => `export const ${name} = undefined;`).join("\n")),
  };
  return source.replace(/(\bfrom\s*)(["'])(react(?:-dom|\/jsx-runtime)?|@paperclipai\/plugin-sdk\/ui)\2/g,
    (_match, prefix: string, _quote: string, specifier: keyof typeof shims) => `${prefix}${JSON.stringify(shims[specifier])}`);
}

describe("Crew plugin UI bundle", () => {
  it("bundles require-call React dependencies and loads its component exports through host shims", async () => {
    execFileSync(process.execPath, ["build.mjs"], { cwd: packageRoot, stdio: "pipe" });
    const bundlePath = resolve(packageRoot, "dist/ui/index.js");
    const bundle = readFileSync(bundlePath, "utf8");

    expect(bundle).not.toMatch(/require\s*\(\s*["']react(?:["']|\/)/);

    globalThis.__paperclipPluginBridge__ = {
      react: React,
      reactDom: ReactDom,
      reactJsxRuntime: ReactJsxRuntime,
      sdkUi: {},
    };
    try {
      const loaded = await import(dataModule(hostRewrite(bundle)));
      expect(typeof loaded.CrewIssueTab).toBe("function");
      expect(typeof loaded.CrewIssueSummary).toBe("function");
      expect(typeof loaded.CrewPage).toBe("function");
      expect(typeof loaded.MachinesWidget).toBe("function");
      expect(typeof loaded.CrewGuidePage).toBe("function");
      expect(typeof loaded.CrewGuideSidebarLink).toBe("function");
    } finally {
      delete globalThis.__paperclipPluginBridge__;
    }
  });
});
