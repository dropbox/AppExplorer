import * as vscode from "vscode";
import { HandlerContext } from "./extension";
import { getRelativePath } from "./get-relative-path";
import { makeCardData } from "./make-new-card-handler";
import { CardData } from "./EventTypes";
import { notEmpty } from "./make-tag-card-handler";

export const makeAttachCardHandler = ({
  waitForConnections,
  emit,
  query,
  sockets,
  setCard,
}: HandlerContext) => {
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
        const result = await makeCardData(editor, {
          canPickMany: false,
          defaultTitle: selectedCards[0].title,
        });
        const cardData = result?.[0];
        if (cardData) {
          emit("attachCard", cardData);
          if (cardData.miroLink) {
            setCard(cardData.miroLink, cardData);
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
