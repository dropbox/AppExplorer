import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import { checkpointRegex } from "../../utils/log-checkpoint";
import { E2ETestUtils, videoDelay } from "../helpers/e2e-test-utils";

export const delay = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export type Options = {
  name?: string;
  timeout?: number;
  interval?: number;
  message?: string;
};

type ListPredicate = string[];

/**
 * Wait for a log line matching the predicate.
 */
export async function waitForLog<T extends string>(
  predicate: T[],
  options?: Options,
): Promise<T> {
  const matcher = (line: string) => predicate.some((p) => line.includes(p));

  const v = await waitForValue(
    () =>
      E2ETestUtils.getCapturedLogs().find(matcher)?.match(checkpointRegex)?.[0],
    {
      name: `Log (${predicate.join(", ")})`,
      ...options,
    },
  );

  return v as T;
}

export async function waitForValue<T>(
  getValue: () => T | undefined,
  {
    name = "Value",
    timeout = 25000,
    interval = 500,
    message = `${name} not found within timeout period`,
  }: Options = {},
) {
  return waitFor(
    async () => {
      const value = await getValue();
      assert.ok(value !== undefined, message);
      return value;
    },
    { timeout, interval, message },
  );
}

export async function waitFor<T>(
  assertion: () => Promise<T> | T,
  {
    timeout = 25000,
    interval = 500,
    message = "Condition not met within timeout period",
  }: Options = {},
): Promise<T> {
  const start = Date.now();

  while (true) {
    try {
      const result = await assertion();
      await videoDelay();
      return result;
    } catch (e) {
      if (Date.now() - start >= timeout) {
        throw new assert.AssertionError({
          message: `${message}\nLast error: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
      await delay(interval);
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
