import * as child from "child_process";
import * as path from "path";

// git rev-parse --short HEAD

export function getCommitHash(fullPath: string): string {
  const hash = child.spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    encoding: "utf-8",
    cwd: path.dirname(fullPath),
  });

  return hash.stdout.trim();
}

export function getRemoteURL(fullPath: string): string {
  const hash = child.spawnSync("git", ["remote", "-v"], {
    encoding: "utf-8",
    cwd: path.dirname(fullPath),
  });

  const github = String(hash.stdout).match(
    /git@github.com:([^/\s]+)\/([^/\s]+)(.git)/
  );

  if (github) {
    return github[0];
  }

  return "https://example.com/unknown_remote";
}
