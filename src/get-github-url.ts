import * as vscode from "vscode";
import * as path from "path";
import { getRelativePath } from "./get-relative-path";
import * as util from "util";
import * as child_process from "child_process";
export const exec = util.promisify(child_process.exec);

export async function getGitHubUrl(
  locationLink: vscode.LocationLink
): Promise<string | null> {
  const document = await vscode.workspace.openTextDocument(
    locationLink.targetUri
  );
  const uri = document.uri;
  const filePath = uri.fsPath;
  const relativeFilePath = getRelativePath(uri);

  // Get the current git hash
  const gitHash = await exec("git rev-parse HEAD", {
    cwd: path.dirname(filePath),
  })
    .then(({ stdout }) => stdout.trim())
    .catch(() => null);

  if (!gitHash) {
    return null;
  }

  // Get the remote URL for the current repository
  const gitRemoteUrl = await exec("git config --get remote.origin.url", {
    cwd: path.dirname(filePath),
  })
    .then(({ stdout }) => stdout.trim())
    .catch(() => null);

  if (!gitRemoteUrl) {
    return null;
  }

  // Parse the remote URL to get the repository owner and name
  const gitRemoteUrlParts = gitRemoteUrl.match(
    /github\.com[:/](.*)\/(.*)\.git/
  );
  if (!gitRemoteUrlParts) {
    return null;
  }
  const gitRepoOwner = gitRemoteUrlParts[1];
  const gitRepoName = gitRemoteUrlParts[2];

  const lineNumber =
    locationLink.targetSelectionRange?.start.line ??
    locationLink.targetRange.start.line;

  // Construct the GitHub URL for the current file and line number
  const gitHubUrl = `https://github.com/${gitRepoOwner}/${gitRepoName}/blob/${gitHash}/${relativeFilePath}#L${lineNumber}`;

  return gitHubUrl;
}
