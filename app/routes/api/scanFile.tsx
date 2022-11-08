import type { ActionFunction, LoaderFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import invariant from "tiny-invariant";
import * as fs from "~/utils/fs.server";

type TaggedComment = {
  type: "TaggedComment";
  filePath: string;
  commentStartLine: number;
  rawText: string;
};

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
 * This API route only returns JSON from a loader. It uses scanFile
 * and composes a set of scanners together.
 *
 * If I want a scanner that's just a subset, like maybe I fetch the annotations
 * separately, or make a different scanner powered by Bazel, it can just be
 * another route.
 *
 * @AppExplorer
 * @param param0
 * @returns
 */
export const loader: LoaderFunction = async ({ request }) => {
  const url = new URL(request.url);

  const path = url.searchParams.get("path");
  invariant(path, "path required");

  const scanResult = await scanAppExplorerComments(path);
  invariant(scanResult);

  return json<FileScanResult>(scanResult);
};

async function scanAppExplorerComments(path: string) {
  invariant(process.env.REPO_ROOT, "This file requires a REPO_ROOT");
  const fullPath = fs.pathJoin(process.env.REPO_ROOT, path);
  const file = String(await fs.readFile(fullPath));
  const lines = file.split("\n");
  const results: Array<TaggedComment> = [];
  let status = "idle" as "idle" | "comment" | "tag";
  let comment = [];
  let commentStartLine = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (status === "idle" && line.includes("/**")) {
      commentStartLine = i + 1;
      status = "comment";
    }
    if (status === "comment" && line.includes("@AppExplorer")) {
      status = "tag";
    }
    if (["tag", "comment"].includes(status)) {
      comment.push(line);
      if (line.includes("*/")) {
        if (status === "tag") {
          results.push({
            type: "TaggedComment",
            filePath: path,
            commentStartLine,
            rawText: comment.join("\n"),
          });
        }
        status = "idle";
      }
    }
  }
  return results;
}
