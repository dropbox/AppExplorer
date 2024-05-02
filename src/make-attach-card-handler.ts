import * as vscode from "vscode";
import { HandlerContext } from "./extension";
import { getRelativePath } from "./get-relative-path";
import { makeCardData } from "./make-new-card-handler";


export const makeAttachCardHandler
 = ({
  waitForConnections,
  emit,
  selectedCards,
  allCards,
}: HandlerContext) => {

  return async function () {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      const uri = getRelativePath(editor.document.uri);
      if (!uri) {
        return;
      }
      await waitForConnections();

      if (selectedCards.length === 1) {
        const cardData = await makeCardData(editor);
        if (cardData) {
          emit("attachCard", cardData);
          if (cardData.miroLink) {
            allCards.set(cardData.miroLink, cardData)
          }
        }
      } else {
        vscode.window.showInformationMessage("Please select a single card to attach");
      }

    }
  };
}

