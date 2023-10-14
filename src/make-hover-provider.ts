import * as vscode from "vscode";
import { CardData } from "./EventTypes";

export function makeHoverProvider(context: vscode.ExtensionContext) {
  const m = new WeakMap<vscode.TextEditor, CardData[]>();
  const hoverProvider = vscode.languages.registerHoverProvider(
    { scheme: "file" },
    {
      provideHover(document, position) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          return;
        }

        const cards = m.get(editor);
        if (!cards) {
          return;
        }

        const range = document.getWordRangeAtPosition(position);
        if (!range) {
          return;
        }

        const word = document.getText(range);
        const card = cards.find((card) => card.title === word);
        if (!card) {
          return;
        }

        const contents = new vscode.MarkdownString();
        contents.appendMarkdown(`Miro: [${card.title}](${card.miroLink})\n`);

        return new vscode.Hover(contents, range);
      },
    }
  );

  context.subscriptions.push(hoverProvider);
  return m;
}
