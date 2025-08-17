import baseDebug from "debug";

export function createDebug(namespace: `app-explorer:${string}`) {
  const debug = baseDebug(namespace);
  debug.error = (...args: unknown[]) => {
    // eslint-disable-next-line no-console
    console.error(...args);
    debug.apply(null, ["error", ...args]);
  };
  return debug;
}
createDebug.enable = baseDebug.enable.bind(baseDebug);
createDebug.log = (...args: unknown[]) => baseDebug.log(...args);
