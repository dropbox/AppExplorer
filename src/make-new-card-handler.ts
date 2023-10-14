import * as vscode from "vscode";
import { HandlerContext, makeCardData } from "./extension";
import { getRelativePath } from "./get-relative-path";

export const makeNewCardHandler = ({
  waitForConnections,
  emit,
}: HandlerContext) =>
  async function () {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      const uri = getRelativePath(editor.document.uri);
      if (!uri) {
        return;
      }
      await waitForConnections();

      const cardData = await makeCardData(editor);

      if (cardData) {
        const title = await vscode.window.showInputBox({
          prompt: "Card title",
          value: cardData.title.trim(),
        });
        if (title) {
          cardData.title = title;
          emit("newCard", cardData);
        }
      }
    }
  };
