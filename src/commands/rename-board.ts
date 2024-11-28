import * as vscode from "vscode";
import type { HandlerContext } from "../extension";

export function makeRenameHandler(context: HandlerContext) {
  return async () => {
    await context.waitForConnections();
    const connectedBoardIds = [...context.sockets.keys()];
    const boards = connectedBoardIds.map(
      (k) => context.cardStorage.getBoard(k)!,
    );

    const items = boards.map((board): vscode.QuickPickItem => {
      return {
        label: board.name ?? board.id,
        detail: `${Object.keys(board.cards).length} cards`,
      };
    });

    const selected = await vscode.window.showQuickPick(items, {
      title: "Which board would you like to rename?",
    });
    if (!selected) {
      return;
    }
    const index = items.indexOf(selected);
    const boardId = connectedBoardIds[index];

    const newName = await vscode.window.showInputBox({
      value: selected.label,
      prompt: "Enter new name",
    });

    if (!newName) {
      return;
    }
    const socket = context.sockets.get(boardId)!;
    await context.query(socket, "setBoardName", newName);
    context.cardStorage.setBoardName(boardId, newName);
  };
}
