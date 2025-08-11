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
  const context = [];
  context.push(
    await esbuild.context({
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
    }),
  );
  context.push(
    await esbuild.context({
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
    }),
  );
  context.push(
    await esbuild.context({
      entryPoints: ["src/sidebar.ts"],
      bundle: true,
      format: "esm",
      minify: production,
      sourcemap: !production,
      sourcesContent: false,
      platform: "browser",
      outfile: "public/sidebar.js",
      external: [],
      logLevel: "silent",
      plugins: [
        /* add to the end of plugins array */
        esbuildProblemMatcherPlugin,
      ],
    }),
  );
  if (watch) {
    await Promise.all(context.map((ctx) => ctx.watch()));
  } else {
    await Promise.all(context.map((ctx) => ctx.rebuild()));
    await Promise.all(context.map((ctx) => ctx.dispose()));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
