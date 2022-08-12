import type { Card } from "@mirohq/websdk-types";
import type { JSDocReport } from "~/scanner/jsdoc-scanner";
import type { ReactComponentReport } from "../scanner/react-component-scanners";
import type { DebugLog, RepoData } from "../scanner/scanner.server";

// I decoupled the scanner (scanner.server) from the scanning
// (react-component-scanner), but I don't know a good strategy for the chart. So
// this is the central type for the chart that represents the output of the
// scanner.
export type ScanData = ReactComponentReport & DebugLog & RepoData & JSDocReport;

export const padding = 10;

export async function upsertTag(title = "AppExplorer") {
  const tags = await miro.board.get({
    type: "tag",
  });
  const tag = tags.find((t) => t.title === title);
  if (!tag) {
    return await miro.board.createTag({
      title,
      color: "blue",
    });
  }
  return tag;
}

export const readProjectId = (appCard: Card) => {
  const p = appCard.description.match(/project:(.*)/);
  return p ? p[1] : null;
};

// appCard.fields?.flatMap((f) => { const [key, value] = f.value?.split(":", 2) ?? [];
//   if (key === "path") {
//     return value;
//   }
//   return [];
// })[0];

export const makeTagCache = (name: string) => {
  let id: string;
  return async () => id ?? (id = (await upsertTag(name)).id);
};

export const appExplorerTagId = makeTagCache("AppExplorer");
export const todoTagId = makeTagCache("TODO");

export type Dimensions = {
  x: number;
  y: number;
  height: number;
  width: number;
};

export const constructionArea = {
  x: 0,
  y: 0,
  width: 3000,
  height: 3000,
};

export const GITHUB_ORIGIN = /git@github.com:([^/\s]+)\/([^/\s]+)(.git)/;
