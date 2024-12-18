import * as vscode from "vscode";
import { HandlerContext } from "../extension";
import { getRelativePath } from "../get-relative-path";
import { makeCardData } from "./create-card";
import { CardData } from "../EventTypes";
import { notEmpty } from "./tag-card";

export const makeAttachCardHandler = (context: HandlerContext) => {
  const { waitForConnections, query, sockets, cardStorage } = context;

  return async function () {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      const uri = getRelativePath(editor.document.uri);
      if (!uri) {
        return;
      }
      await waitForConnections();
      const selectedCards = await [...sockets.values()].reduce(
        async (p, socket) => {
          const selected: CardData[] = await p;
          const selectedCards = await query(socket, "selected");
          return selected.concat(selectedCards).filter(notEmpty);
        },
        Promise.resolve([] as CardData[]),
      );

      if (selectedCards.length === 1) {
        const boardId = selectedCards[0].boardId;
        const socket = sockets.get(boardId);
        const result = await makeCardData(editor, boardId, {
          canPickMany: false,
          defaultTitle: selectedCards[0].title,
        });
        const cardData = result?.[0];
        if (cardData && socket) {
          socket.emit("attachCard", cardData);
          if (cardData.miroLink) {
            cardStorage.setCard(cardData.miroLink, cardData);
          }
        }
      } else {
        vscode.window.showInformationMessage(
          "Please select a single card to attach",
        );
      }
    }
  };
};
