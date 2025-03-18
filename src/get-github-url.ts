import * as vscode from "vscode";
import * as path from "path";
import { getRelativePath } from "./get-relative-path";
import { GitUtils, DefaultGitUtils } from "./git-utils";

export async function getGitHubUrl(
  locationLink: vscode.LocationLink,
  gitUtils: GitUtils = new DefaultGitUtils(),
): Promise<string | null> {
  const document = await vscode.workspace.openTextDocument(
    locationLink.targetUri,
  );
  const uri = document.uri;
  const filePath = uri.fsPath;
  const relativeFilePath = getRelativePath(uri);
  const cwd = path.dirname(filePath);

  const gitHash = await gitUtils.getCurrentHash(cwd);
  if (!gitHash) {
    return null;
  }

  const gitRemotes = await gitUtils.getRemotes(cwd);
  let remoteName = "origin";
  if (!gitRemotes.includes(remoteName)) {
    remoteName = gitRemotes[0];
  }

  const gitRemoteUrl = await gitUtils.getRemoteUrl(remoteName, cwd);
  if (!gitRemoteUrl) {
    return null;
  }

  // Parse the remote URL to get the repository owner and name
  const gitRemoteUrlParts = gitRemoteUrl.match(
    /(git@)?github\.com[:/](.*)\/(.*)(\.git)?/,
  );
  if (!gitRemoteUrlParts) {
    return null;
  }
  const gitRepoOwner = gitRemoteUrlParts[2];
  const gitRepoName = gitRemoteUrlParts[3]?.replace(/\.git$/, "");

  const range = locationLink.targetSelectionRange ?? locationLink.targetRange;

  const lineNumber = range.start.line + 1;
  const endLine = range.end.line + 1;
  const hash =
    lineNumber === endLine ? `#L${lineNumber}` : `#L${lineNumber}-L${endLine}`;

  const url = new URL("https://github.com");
  url.pathname = `${gitRepoOwner}/${gitRepoName}/blob/${gitHash}/${relativeFilePath}`;
  url.hash = hash;

  return url.toString();
}
