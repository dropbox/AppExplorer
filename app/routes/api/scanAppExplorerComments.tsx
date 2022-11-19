import invariant from "tiny-invariant";
import * as fs from "~/utils/fs.server";
import { getPermalink } from "~/utils/git.server";
import type { TaggedComment } from "./scanFile";

/**
 * To make this compatible with more languages, I'm just managing the file as a
 * string.  Specifically it's an array of lines looking for a start of a
 * comment, an AppExplorer tag and an end comment.
 *
 * Other scanners are welcome to use other tools. It's just a function that
 * takes a path and returns an array of something. FileScanResult is the type
 * that combines all the scanners.
 *
 * @AppExplorer https://miro.com/app/board/uXjVPBl8yvs=/?moveToWidget=3458764539084149499
 */
export async function scanAppExplorerComments(path: string) {
  invariant(process.env.REPO_ROOT, "This file requires a REPO_ROOT");
  const fullPath = fs.pathJoin(process.env.REPO_ROOT, path);
  const file = String(await fs.readFile(fullPath));
  const lines = file.split("\n");
  const results: Array<TaggedComment> = [];
  let status = "idle" as "idle" | "comment" | "tag";
  let comment = [];
  let commentStartLine = 0;

  const STAR = "*";
  const AT = "@";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (status === "idle" && line.includes("/" + STAR + STAR)) {
      commentStartLine = i + 1;
      status = "comment";
    }
    if (status === "comment" && line.includes(AT + "AppExplorer")) {
      status = "tag";
    }
    if (["tag", "comment"].includes(status)) {
      comment.push(line);
      if (line.includes(STAR + "/")) {
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
        comment.length = 0;
      }
    }
  }

  return results;
}
