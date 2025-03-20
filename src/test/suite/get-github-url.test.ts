import * as assert from "assert";
import * as vscode from "vscode";
import { getGitHubUrl } from "../../get-github-url";
import { GitUtils } from "../../git-utils";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { uriForFile } from "./test-utils";

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
  let targetUri: vscode.Uri;

  suiteSetup(async () => {
    targetUri = uriForFile("example.ts");
  });

  test("generates correct GitHub URL for single line", async () => {
    const locationLink: vscode.LocationLink = {
      targetUri,
      targetRange: new vscode.Range(9, 0, 9, 0),
      targetSelectionRange: new vscode.Range(9, 0, 9, 0),
    };

    const url = await getGitHubUrl(locationLink, mockGitUtils);
    assert.strictEqual(
      url,
      "https://github.com/testowner/testrepo/blob/abcd1234/example.ts#L10",
    );
  });

  test("generates correct GitHub URL for multiple lines", async () => {
    const locationLink: vscode.LocationLink = {
      targetUri,
      targetRange: new vscode.Range(9, 0, 12, 0),
      targetSelectionRange: new vscode.Range(9, 0, 12, 0),
    };

    const url = await getGitHubUrl(locationLink, mockGitUtils);
    assert.strictEqual(
      url,
      "https://github.com/testowner/testrepo/blob/abcd1234/example.ts#L10-L13",
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
      targetUri,
      targetRange: new vscode.Range(0, 0, 0, 0),
      targetSelectionRange: new vscode.Range(0, 0, 0, 0),
    };

    const url = await getGitHubUrl(locationLink, failingGitUtils);
    assert.strictEqual(url, null);
  });
});
