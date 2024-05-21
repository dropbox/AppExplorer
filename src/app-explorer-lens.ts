import * as vscode from "vscode";
import { getRelativePath } from "./get-relative-path";
import { HandlerContext } from "./extension";
import { invariant, readSymbols } from "./make-new-card-handler";
import { CardData } from "./EventTypes";

export class AppExplorerLens implements vscode.CodeLensProvider {
  #handlerContext: HandlerContext;

  constructor(handlerContext: HandlerContext) {
    this.#handlerContext = handlerContext;
  }
  async provideCodeLenses(
    document: vscode.TextDocument
  ): Promise<vscode.CodeLens[]> {
    const path = getRelativePath(document.uri);
    const cards = [...this.#handlerContext.allCards.values()].filter(
      (card) => card.path === path
    );
    const symbols = await readSymbols(document.uri);
    return cards.flatMap((card: CardData): vscode.CodeLens[] => {
      if (card.type === "symbol") {
        const symbol = symbols.find((symbol) => symbol.label === card.symbol);

        if (symbol) {
          invariant(symbol.range, "Symbol range is missing");
          let range = symbol.range;
          range = new vscode.Range(range.start, range.start);


          const c: vscode.Command = {
            command: "app-explorer.navigate",
            title: `${card.title}$(link-external)`,
            arguments: [card.miroLink]
          };

          const codeLens = new vscode.CodeLens(range, c);
          return [codeLens];
        } else {
          console.warn(`Symbol ${card.symbol} not found in ${path}`);
          console.warn("symbols", symbols);
        }
      } else {
        console.warn("Not a symbol card", card);
      }
      return [];
    });
  }
}


export const makeNavigationHandler = (context: HandlerContext) => {

  return (miroLink: string) => {

    const card = context.allCards.get(miroLink);
    if (card && context.sockets.size > 0) {
    vscode.window.showInformationMessage(`Selecting card ${card.title}`);
      context.sockets.forEach((socket) => {
        socket.emit("selectCard", miroLink);
      });
    } else {
      vscode.window.showInformationMessage(`Opening card ${miroLink} in browser`);
      // Open the URL in the browser
      vscode.env.openExternal(vscode.Uri.parse(miroLink));
    }
  }
}