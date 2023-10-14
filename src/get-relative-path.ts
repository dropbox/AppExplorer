import * as vscode from "vscode";
import * as path from "path";

export function getRelativePath(uri: vscode.Uri): string | undefined {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders) {
    for (const folder of workspaceFolders) {
      if (uri.fsPath.startsWith(folder.uri.fsPath)) {
        return path.relative(folder.uri.fsPath, uri.fsPath);
      }
    }
  }
  return undefined;
}
