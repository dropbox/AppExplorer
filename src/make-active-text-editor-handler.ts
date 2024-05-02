import * as vscode from "vscode";
import { HandlerContext } from "./extension";
import { getRelativePath } from "./get-relative-path";
import { makeHoverProvider } from "./make-hover-provider";
import { CardData } from "./EventTypes";
import { readSymbols } from "./make-new-card-handler";

export const makeActiveTextEditorHandler = (
  handlerContext: HandlerContext,
  editorCards: ReturnType<typeof makeHoverProvider>
) => {
  const color = "editorInlayHint.foreground";

  const cardDecoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
  });
  async function decordateEditor(editor: vscode.TextEditor | undefined) {
    handlerContext.renderStatusBar();
    if (editor) {
      const uri = editor.document.uri;
      const path = getRelativePath(uri);
      if (path) {
        const cards = [...handlerContext.allCards.values()].filter(
          (card) => card.path === path
        );
        editorCards.set(editor, cards);
        console.log("cards", cards);
        const decorations: vscode.DecorationOptions[] = [];

        const position = editor.selection.active;
        const symbols = await readSymbols(editor, position);
        cards.forEach((card: CardData) => {
          if (card.symbol) {
            const symbol = symbols.find(
              (symbol) => symbol.name === card.symbol
            );

            if (symbol) {
              let range;
              if ("location" in symbol) {
                range = symbol.location.range;
              } else {
                range = symbol.range;
              }

              range = new vscode.Range(range.start, range.start);

              decorations.push({
                range,
                renderOptions: {
                  after: {
                    contentText: `  AppExplorer: ${card.title}`,
                    color: color,
                    fontWeight: "bold",
                  },
                },
              });
            } else {
              console.warn(`Symbol ${card.symbol} not found in ${path}`);
              console.warn("symbols", symbols);
            }
          }
        });
        editor.setDecorations(cardDecoration, decorations);
        vscode.window.showInformationMessage(
          `Found ${cards.length} cards in ${path}`
        );
      }

      handlerContext.lastUri = uri;
    }
  }

  return decordateEditor;
};
