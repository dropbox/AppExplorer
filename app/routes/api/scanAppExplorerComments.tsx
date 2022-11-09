import invariant from "tiny-invariant";
import * as fs from "~/utils/fs.server";
import { getPermalink } from "~/utils/git.server";
import type { TaggedComment } from "./scanFile";

export async function scanAppExplorerComments(path: string) {
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
          const permalink = getPermalink(path, commentStartLine);
          results.push({
            type: "TaggedComment",
            permalink,
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
