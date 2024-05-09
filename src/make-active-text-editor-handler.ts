import * as vscode from "vscode";
import { HandlerContext } from "./extension";
import { getRelativePath } from "./get-relative-path";
import { makeHoverProvider } from "./make-hover-provider";
import { CardData } from "./EventTypes";
import { readSymbols } from "./make-new-card-handler";
function invariant(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

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
        const decorations: vscode.DecorationOptions[] = [];

        const symbols = await readSymbols(editor.document.uri);
        cards.forEach((card: CardData) => {
          if (card.type === "symbol") {
            const symbol = symbols.find(
              (symbol) => symbol.label === card.symbol
            );

            if (symbol) {
              invariant(symbol.range, "Symbol range is missing");
              let range = symbol.range;
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
          } else {
            console.warn('Not a symbol card', card)
          }
        });
        editor.setDecorations(cardDecoration, decorations);
        vscode.window.showInformationMessage(
          `Found ${decorations.length} symbols on ${cards.length} cards for ${path}`
        );
      }

      handlerContext.lastUri = uri;
    }
  }

  return decordateEditor;
};
