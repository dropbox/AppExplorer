import { defineConfig } from "@vscode/test-cli";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  files: "compiled-tests/test/**/*.test.js",
  mocha: {
    timeout: 10000,
  },
  extensionDevelopmentPath: __dirname,

  workspaceFolder: `${__dirname}/sample-workspace/`,
  launchArgs: ["--disable-extensions"],
  coverage: {
    // include: ["src/**/*.ts", "dist/**/*.js", "out/**/*.js"],
    // exclude: ["src/test/**/*", "compiled-tests/**/*", "node_modules/**/*"],
    reporter: ["text", "html"],
    output: "coverage",
  },
});
