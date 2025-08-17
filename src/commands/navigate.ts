import * as vscode from "vscode";
import type { HandlerContext } from "../extension";
import { getGitHubUrl } from "../get-github-url";
import { createDebug } from "../utils/create-debug";
const debug = createDebug("app-explorer:navigate");

export const makeNavigationHandler = (context: HandlerContext) => {
  return async (miroLink: string, locationLink: vscode.LocationLink) => {
    const card = context.cardStorage.getCardByLink(miroLink);
    debug("navigateTo", miroLink, locationLink);
    if (card && context.cardStorage.getConnectedBoards().length > 0) {
      const boardId = card.boardId;
      const codeLink = await getGitHubUrl(locationLink);

      await context.cardStorage.socket.emitWithAck("cardStatus", boardId, {
        codeLink,
        miroLink,
        status: "connected",
      });

      const success = await context.cardStorage.socket.emitWithAck(
        "selectCard",
        boardId,
        miroLink,
      );
      debug("selectCard result", success);

      if (success) {
        await vscode.window.showInformationMessage(
          `Selected card ${card.title} [${miroLink}]`,
        );
      } else {
        await vscode.window.showErrorMessage(
          `Failed to select card ${card.title} [${miroLink}]`,
        );
      }
    } else {
      vscode.window.showInformationMessage(
        `Opening card ${miroLink} in browser`,
      );
      // Open the URL in the browser
      vscode.env.openExternal(vscode.Uri.parse(miroLink));
    }
  };
};
