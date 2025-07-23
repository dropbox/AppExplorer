import { defineConfig } from "@vscode/test-cli";

// Avoid port 9042
const APP_EXPLORER_PORT = 9043 + Math.floor(Math.random() * (9099 - 9043));
// I haven't been able to get the environment variable to work. I have had to
// use createDebug.enable() instead
const DEBUG = "app-explorer:test:*";

export default defineConfig({
  files: "out/test/**/*.test.js",
  workspaceFolder: "./sample-workspace",
  env: {
    APP_EXPLORER_PORT,
    DEBUG,
  },
  coverage: {
    enabled: true,
    reporter: "html",
  },
  mocha: {
    timeout: 30000, // 30 seconds timeout for all tests
    slow: 10000, // Mark tests as slow if they take more than 10 seconds
  },
});
