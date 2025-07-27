import * as vscode from "vscode";
import type { HandlerContext } from "../extension";

export function makeWorkspaceBoardHandler(context: HandlerContext) {
  return async () => {
    const boards = context.cardStorage
      .listBoardIds()
      .map((k) => context.cardStorage.getBoard(k)!);
    const ids = context.cardStorage.listBoardIds();
    const items = boards.map((board): vscode.QuickPickItem => {
      return {
        label: board.name ?? board.id,
        detail: `${Object.keys(board.cards).length} cards`,
        picked: ids.includes(board.id),
      };
    });

    const selected = await vscode.window.showQuickPick(items, {
      title: "Which boards should be associated with this workspace?",
      canPickMany: true,
    });

    if (selected) {
      context.cardStorage.setWorkspaceBoards(
        selected.map((s) => boards[items.indexOf(s)].id),
      );
    }
  };
}
