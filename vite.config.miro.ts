import { defineConfig } from "vite";

const rollupOptions = {
  external: [
    "child_process",
    "crypto",
    "events",
    "fs",
    "http",
    "https",
    "net",
    "path",
    "querystring",
    "stream",
    "timers",
    "tls",
    "url",
    "util",
    "vscode",
    "ws",
    "zlib",
  ],
};
export default defineConfig({
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    sourcemap: true,
    lib: {
      entry: {
        miro: "index.html",
      },
      name: "miro",
      // formats: ["cjs"],
    },
    rollupOptions,
  },
});
