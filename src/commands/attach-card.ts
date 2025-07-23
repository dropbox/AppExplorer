import * as vscode from "vscode";
import { CardData } from "../EventTypes";
import { HandlerContext } from "../extension";
import { getRelativePath } from "../get-relative-path";
import { makeCardData } from "./create-card";
import { notEmpty } from "./tag-card";

export const makeAttachCardHandler = (context: HandlerContext) => {
  return async function () {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      const uri = getRelativePath(editor.document.uri);
      if (!uri) {
        return;
      }
      await context.waitForConnections();
      const selectedCards = await context.cardStorage
        .getConnectedBoards()
        .reduce(
          async (p, boardId) => {
            const selected: CardData[] = await p;
            // Use universal query method through WorkspaceCardStorageProxy
            const selectedCards = await context.cardStorage.query(
              boardId,
              "selected",
            );
            return selected.concat(selectedCards).filter(notEmpty);
          },
          Promise.resolve([] as CardData[]),
        );

      if (selectedCards.length === 1) {
        const boardId = selectedCards[0].boardId;
        const result = await makeCardData(editor, boardId, {
          canPickMany: false,
          defaultTitle: selectedCards[0].title,
        });
        const cardData = result?.[0];
        if (cardData) {
          // Use universal query method through WorkspaceCardStorageProxy
          context.cardStorage.query(boardId, "attachCard", cardData);
          if (cardData.miroLink) {
            context.cardStorage.setCard(cardData.miroLink, cardData);
          }
          return [cardData];
        }
      } else {
        vscode.window.showInformationMessage(
          "Please select a single card to attach",
        );
      }
    }
    return [];
  };
};
