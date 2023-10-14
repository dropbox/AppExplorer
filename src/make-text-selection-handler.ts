import * as vscode from "vscode";
import { HandlerContext } from "./extension";

export const makeTextSelectionHandler =
  (handlerContext: HandlerContext) =>
  (event: vscode.TextEditorSelectionChangeEvent) => {
    const editor = event.textEditor;
    if (editor) {
      const position = editor.selection.active;
      const uri = editor.document.uri;
      if (
        handlerContext.lastPosition &&
        handlerContext.lastUri &&
        uri.fsPath !== handlerContext.lastUri.fsPath
      ) {
        handlerContext.emit("jump", {
          lastUri: handlerContext.lastUri.toString(),
          lastPosition: handlerContext.lastPosition,
          uri: uri.toString(),
          position: position,
        });
      }
      handlerContext.lastPosition = position;
      handlerContext.lastUri = uri;
    }
  };
