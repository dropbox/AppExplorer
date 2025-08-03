import * as vscode from "vscode";
import { CardData } from "../EventTypes";
import { HandlerContext } from "../extension";
import { getRelativePath } from "../get-relative-path";
import { notEmpty } from "../utils/notEmpty";
import { makeCardData } from "./create-card";

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
        .reduce(async (p, boardId) => {
          const selected: CardData[] = await p;
          const selectedCards = await context.cardStorage.socket.emitWithAck(
            "selected",
            boardId,
          );
          return selected.concat(selectedCards).filter(notEmpty);
        }, Promise.resolve<CardData[]>([]));

      if (selectedCards.length === 1) {
        const boardId = selectedCards[0].boardId;
        const result = await makeCardData(editor, boardId, {
          canPickMany: false,
          defaultTitle: selectedCards[0].title,
        });
        const cardData = result?.[0];
        if (cardData) {
          await context.cardStorage.socket.emitWithAck(
            "attachCard",
            cardData.boardId,
            cardData,
          );
          if (cardData.miroLink) {
            await context.cardStorage.setCard(cardData.miroLink, cardData);
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
