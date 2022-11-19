import type { ActionFunction, LoaderFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import invariant from "tiny-invariant";
import * as fs from "~/utils/fs.server";
import { scanAppExplorerComments } from "./scanAppExplorerComments";

export type TaggedComment = {
  type: "TaggedComment";
  filePath: string;
  permalink: string;
  commentStartLine: number;
  rawText: string;
};

/**
 * FileScanResult holds all the types that are supported by the scanner. Today
 * it's only TaggedComment. When a new scanner is added, this will get a new type.
 *
 * @AppExplorer https://miro.com/app/board/uXjVPBl8yvs=/?moveToWidget=3458764539084002810
 */
export type FileScanResult = Array<TaggedComment>;

export const action: ActionFunction = async ({ request }) => {
  const formData = await request.formData();

  const filePath = formData.get("filePath");
  const line = Number(formData.get("line"));
  const content = formData.get("content");

  invariant(typeof filePath === "string", "filePath required");
  invariant(line, "line required");
  invariant(typeof content === "string", "content required");

  invariant(process.env.REPO_ROOT, "This file requires a REPO_ROOT");
  const fullPath = fs.pathJoin(process.env.REPO_ROOT, filePath);
  const file = String(await fs.readFile(fullPath));
  const lines = file.split("\n");
  const contentLines = content.split("\n");

  lines.splice(line - 1, contentLines.length, ...contentLines);

  await fs.writeFile(fullPath, lines.join("\n"));

  return json({});
};

/**
 * This route uses a loader without a default export to make it a JSON API
 * route.
 *
 * @AppExplorer https://miro.com/app/board/uXjVPBl8yvs=/?moveToWidget=3458764539084002865
 */
export const loader: LoaderFunction = async ({ request }) => {
  const url = new URL(request.url);

  const path = url.searchParams.get("path");
  invariant(path, "path required");

  const scanResult = await scanAppExplorerComments(path);
  invariant(scanResult);

  return json<FileScanResult>(scanResult);
};
