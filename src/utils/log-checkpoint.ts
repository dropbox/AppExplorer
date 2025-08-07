import type vscode from "vscode";
export const CHECKPOINT = {
  quickPick<T extends string>(title: T): `{quickPick:${T}}` {
    return `{quickPick:${title}}`;
  },
  selected<T extends string | vscode.QuickPickItem>(
    value: T,
  ): T extends vscode.QuickPickItem
    ? `{selected:${T["label"]}}`
    : T extends string
      ? `{selected:${T}}`
      : never {
    if (typeof value === "string") {
      // @ts-expect-error
      return `{selected:${value}}`;
    } else {
      // @ts-expect-error
      return `{selected:${value.label}}`;
    }
  },
  createCard: "{createCard:start}",
} as const;

type CheckpointValue = `${keyof typeof CHECKPOINT}:${string}`;

export const checkpointRegex = new RegExp(
  `{(${Object.keys(CHECKPOINT).join("|")}):([^}]+)}`,
  "g",
);
