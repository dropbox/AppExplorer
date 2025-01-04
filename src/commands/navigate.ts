import * as vscode from "vscode";
import type { HandlerContext } from "../extension";
import { getGitHubUrl } from "../get-github-url";
import { MiroServer } from "../server";

export const makeNavigationHandler = (
  context: HandlerContext,
  miroServer: MiroServer,
) => {
  return async (miroLink: string, locationLink: vscode.LocationLink) => {
    const card = context.cardStorage.getCardByLink(miroLink);
    if (card && context.connectedBoards.size > 0) {
      const codeLink = await getGitHubUrl(locationLink);
      vscode.window.showInformationMessage(`Selecting card ${card.title}`);
      miroServer.query(card.boardId, "cardStatus", {
        codeLink,
        miroLink,
        status: "connected",
      });
      miroServer.query(card.boardId, "selectCard", miroLink);
    } else {
      vscode.window.showInformationMessage(
        `Opening card ${miroLink} in browser`,
      );
      // Open the URL in the browser
      vscode.env.openExternal(vscode.Uri.parse(miroLink));
    }
  };
};
