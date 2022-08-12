import * as fs from "fs/promises";
import * as path from "path";

export const stat = fs.stat;
export const readdir = fs.readdir;

export const readFile = fs.readFile;

export const writeFile = fs.writeFile;

export const pathJoin = path.join;
