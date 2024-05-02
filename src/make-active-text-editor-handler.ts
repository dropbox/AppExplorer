import * as vscode from "vscode";
import { HandlerContext } from "./extension";
import { getRelativePath } from "./get-relative-path";
import { makeHoverProvider } from "./make-hover-provider";
import { CardData } from "./EventTypes";


export const makeActiveTextEditorHandler =
  (
    handlerContext: HandlerContext,
    editorCards: ReturnType<typeof makeHoverProvider>
  ) => {

  const cardDecoration = vscode.window.createTextEditorDecorationType({
    // gutterIconPath: path.join(__filename, "..", "images", "card.svg"),
    // gutterIconSize: "contain",
    overviewRulerColor: "blue",
    overviewRulerLane: vscode.OverviewRulerLane.Right,
    isWholeLine: true,
    light: {
      textDecoration: "underline wavy rgba(0, 255, 0, 0.9)",
    },
    dark: {
      textDecoration: "underline wavy rgba(0, 255, 0, 0.3)",
    },
  });
  return (editor: vscode.TextEditor | undefined) => {
    if (editor) {
      const uri = editor.document.uri;
      const path = getRelativePath(uri);
      if (path) {
        const cards = [...handlerContext.allCards.values()].filter(
          (card) => card.path === path
        );
        editorCards.set(editor, cards);
        const decorations: vscode.DecorationOptions[] = [];
        cards.forEach((card: CardData) => {
          decorations.push({
            range: new vscode.Range(
              card.symbolPosition.start.line,
              card.symbolPosition.start.character,
              card.symbolPosition.end.line,
              card.symbolPosition.end.character
            ),
            renderOptions: {},
          });
        });
        editor.setDecorations(cardDecoration, decorations);
        vscode.window.showInformationMessage(
          `Found ${cards.length} cards in ${path}`
        );
      }

      handlerContext.lastUri = uri;
    }
  };
  }