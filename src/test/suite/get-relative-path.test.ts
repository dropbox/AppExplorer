import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { getRelativePath } from "../../get-relative-path";
import { uriForFile } from "./test-utils";

suite("getRelativePath", () => {
  let workspaceDir: string;
  let nestedDir: string;
  let targetUri: vscode.Uri;

  suiteSetup(async () => {
    targetUri = uriForFile("example.ts");
  });

  test("resolves path within workspace root", () => {
    assert.strictEqual(getRelativePath(targetUri), "example.ts");
  });
});
