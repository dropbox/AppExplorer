const esbuild = require("esbuild");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");
const pkgJson = require("./package.json");

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: "esbuild-problem-matcher",

  setup(build) {
    build.onStart(() => {
      console.log("[watch] build started");
    });
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        console.error(
          `    ${location.file}:${location.line}:${location.column}:`,
        );
      });
      console.log("[watch] build finished");
    });
  },
};

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "node",
    outfile: "dist/extension.js",
    external: ["vscode"],
    logLevel: "silent",
    plugins: [
      /* add to the end of plugins array */
      esbuildProblemMatcherPlugin,
    ],
  });
  const miroCtx = await esbuild.context({
    entryPoints: ["src/miro.ts"],
    bundle: true,
    format: "esm",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "browser",
    outfile: "public/miro.js",
    external: [],
    logLevel: "silent",
    plugins: [
      /* add to the end of plugins array */
      esbuildProblemMatcherPlugin,
    ],
  });
  if (watch) {
    await Promise.all([ctx.watch(), miroCtx.watch()]);
  } else {
    await Promise.all([ctx.rebuild(), miroCtx.rebuild()]);
    await Promise.all([ctx.dispose(), miroCtx.dispose()]);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
