import type vscode from "vscode";
export const CHECKPOINT = {
  start<T extends string>(title: T): `{start:${T}}` {
    return `{start:${title}}`;
  },
  done<T extends string>(title: T): `{done:${T}}` {
    return `{done:${title}}`;
  },
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

export type CheckpointValue = `${keyof typeof CHECKPOINT}:${string}`;

export const checkpointRegex = new RegExp(
  `{(${Object.keys(CHECKPOINT).join("|")}):([^}]+)}`,
  "g",
);
