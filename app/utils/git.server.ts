import * as child from "child_process";
import * as path from "path";
import invariant from "tiny-invariant";
import * as fs from "~/utils/fs.server";

// git rev-parse --short HEAD

export function getCommitHash(fullPath: string): string {
  const hash = child.spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    encoding: "utf-8",
    cwd: path.dirname(fullPath),
  });

  return hash.stdout.trim();
}

const GithubRegex =
  /(?:git@|https:\/\/)github.com[:/]([^/\s]+)\/([^/\s]+)(.git)?/;

export function getRemoteURL(fullPath: string): string {
  const hash = child.spawnSync("git", ["remote", "-v"], {
    encoding: "utf-8",
    cwd: path.dirname(fullPath),
  });

  const remote = String(hash.stdout);
  const github = remote.match(GithubRegex);

  if (github) {
    return github[0];
  }

  throw new Error(`Unrecognized remote: ${remote}`);
}

export function getPermalink(path: string, line: number) {
  invariant(process.env.REPO_ROOT, "This file requires a REPO_ROOT");
  const fullPath = fs.pathJoin(process.env.REPO_ROOT, path);
  const remote = getRemoteURL(fullPath);

  const github = remote.match(GithubRegex);
  if (github) {
    return `https://github.com/${github[1]}/${github[2]}/blob/${getCommitHash(
      fullPath
    )}/${path}#L${line}`;
  }

  throw new Error("Unrecognized remote: " + remote);
}
