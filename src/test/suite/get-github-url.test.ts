import * as assert from "assert";
import * as vscode from "vscode";
import { getGitHubUrl } from "../../get-github-url";
import { GitUtils } from "../../git-utils";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

class MockGitUtils implements GitUtils {
  async getCurrentHash(): Promise<string | null> {
    return "abcd1234";
  }

  async getRemotes(): Promise<string[]> {
    return ["origin", "upstream"];
  }

  async getRemoteUrl(): Promise<string | null> {
    return "git@github.com:testowner/testrepo.git";
  }
}

suite("getGitHubUrl", () => {
  const mockGitUtils = new MockGitUtils();

  let workspaceDir: string;
  let testFile: string;

  suiteSetup(async () => {
    // Create temporary workspace
    workspaceDir = path.join(os.tmpdir(), `test-workspace-${Math.random()}`);
    fs.mkdirSync(workspaceDir, { recursive: true });

    // Create a test file
    testFile = path.join(workspaceDir, "test", "file.ts");
    fs.mkdirSync(path.dirname(testFile), { recursive: true });
    fs.writeFileSync(testFile, "// Test content");

    // Add workspace folder
    await vscode.workspace.updateWorkspaceFolders(0, 0, {
      uri: vscode.Uri.file(workspaceDir),
    });
  });

  suiteTeardown(() => {
    // Clean up
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  test("generates correct GitHub URL for single line", async () => {
    const locationLink: vscode.LocationLink = {
      targetUri: vscode.Uri.file(testFile),
      targetRange: new vscode.Range(9, 0, 9, 0),
      targetSelectionRange: new vscode.Range(9, 0, 9, 0),
    };

    const url = await getGitHubUrl(locationLink, mockGitUtils);
    assert.strictEqual(
      url,
      "https://github.com/testowner/testrepo/blob/abcd1234/test/file.ts#L10",
    );
  });

  test("generates correct GitHub URL for multiple lines", async () => {
    const locationLink: vscode.LocationLink = {
      targetUri: vscode.Uri.file(testFile),
      targetRange: new vscode.Range(9, 0, 12, 0),
      targetSelectionRange: new vscode.Range(9, 0, 12, 0),
    };

    const url = await getGitHubUrl(locationLink, mockGitUtils);
    assert.strictEqual(
      url,
      "https://github.com/testowner/testrepo/blob/abcd1234/test/file.ts#L10-L13",
    );
  });

  test("returns null when git commands fail", async () => {
    const failingGitUtils: GitUtils = {
      async getCurrentHash(): Promise<string | null> {
        return null;
      },
      async getRemotes(): Promise<string[]> {
        return [];
      },
      async getRemoteUrl(): Promise<string | null> {
        return null;
      },
    };

    const locationLink: vscode.LocationLink = {
      targetUri: vscode.Uri.file(testFile),
      targetRange: new vscode.Range(0, 0, 0, 0),
      targetSelectionRange: new vscode.Range(0, 0, 0, 0),
    };

    const url = await getGitHubUrl(locationLink, failingGitUtils);
    assert.strictEqual(url, null);
  });
});
