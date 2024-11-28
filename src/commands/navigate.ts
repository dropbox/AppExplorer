import * as vscode from "vscode";
import type { HandlerContext } from "../extension";
import { getGitHubUrl } from "../get-github-url";

export const makeNavigationHandler = (context: HandlerContext) => {
  return async (miroLink: string, locationLink: vscode.LocationLink) => {
    const card = context.cardStorage.getCardByLink(miroLink);
    if (card && context.sockets.size > 0) {
      const codeLink = await getGitHubUrl(locationLink);
      vscode.window.showInformationMessage(`Selecting card ${card.title}`);
      context.sockets.forEach((socket) => {
        socket.emit("cardStatus", {
          codeLink,
          miroLink,
          status: "connected",
        });
        socket.emit("selectCard", miroLink);
      });
    } else {
      vscode.window.showInformationMessage(
        `Opening card ${miroLink} in browser`,
      );
      // Open the URL in the browser
      vscode.env.openExternal(vscode.Uri.parse(miroLink));
    }
  };
};
