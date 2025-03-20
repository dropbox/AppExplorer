import * as vscode from "vscode";
import * as path from "path";
import * as assert from "assert";

export async function waitFor<T>(
  assertion: () => Promise<T> | T,
  {
    timeout = 2000,
    interval = 50,
    message = "Condition not met within timeout period",
  } = {},
): Promise<T> {
  const start = Date.now();

  while (true) {
    try {
      const result = await assertion();
      return result;
    } catch (e) {
      if (Date.now() - start >= timeout) {
        throw new assert.AssertionError({
          message: `${message}\nLast error: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }
}

export function uriForFile(filePath: string) {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  assert.equal(
    workspaceFolders?.length,
    1,
    "Expected exactly 1 workspace folder",
  );
  const workspaceUri = workspaceFolders?.[0].uri!;
  const exampleUri = vscode.Uri.file(path.join(workspaceUri.fsPath, filePath));
  return exampleUri;
}
