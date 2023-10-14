import * as vscode from "vscode";
import { HandlerContext } from "./extension";
import { getRelativePath } from "./get-relative-path";

export const makeActiveTextEditorHandler =
  (handlerContext: HandlerContext) =>
  (editor: vscode.TextEditor | undefined) => {
    if (editor) {
      const uri = editor.document.uri;
      const path = getRelativePath(uri);
      if (path) {
        handlerContext.emit("activeEditor", path);
      }

      handlerContext.lastUri = uri;
    }
  };
