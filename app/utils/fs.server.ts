/**
 * I'm not sure this file is really a good idea, but it's working.  Remix won't
 * bundle a `.server` file, so by naming this `fs.server.ts` I can re-export a
 * few utilities from `fs` and `path`. This allows loaders to access the
 * filesystem without crashing the client bundle.
 *
 * @AppExplorer
 */
import * as fs from "fs/promises";
import * as path from "path";

export const stat = fs.stat;
export const readdir = fs.readdir;

export const readFile = fs.readFile;

export const writeFile = fs.writeFile;

export const pathJoin = path.join;
