import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";

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

export let testName = "";
export function setTestName(n: string) {
  testName = n;
}
export async function uriForFile(filePath: string) {
  const workspaceFolders = await waitFor(() => {
    const folders = vscode.workspace.workspaceFolders;
    assert.equal(folders?.length, 1);
    return folders!;
  });

  const workspaceUri = workspaceFolders?.[0].uri;
  if (workspaceUri) {
    const exampleUri = vscode.Uri.file(
      path.join(workspaceUri.fsPath, filePath),
    );
    return exampleUri;
  }
  throw new Error("No workspace folder found");
}
