import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  files: "out/test/**/*.test.js",
  workspaceFolder: "./sample-workspace",
  mocha: {
    timeout: 30000, // 30 seconds timeout for all tests
    slow: 10000, // Mark tests as slow if they take more than 10 seconds
  },
});
