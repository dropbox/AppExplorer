import * as vscode from "vscode";
import { getRelativePath } from "./get-relative-path";
import { HandlerContext } from "./extension";
import { invariant, readSymbols } from "./commands/create-card";

export class AppExplorerLens implements vscode.CodeLensProvider {
  #handlerContext: HandlerContext;

  constructor(handlerContext: HandlerContext) {
    this.#handlerContext = handlerContext;
  }
  async provideCodeLenses(
    document: vscode.TextDocument,
  ): Promise<vscode.CodeLens[]> {
    const path = getRelativePath(document.uri);
    const cards = [...this.#handlerContext.cardStorage.listAllCards()].filter(
      (card) => card.path === path,
    );
    const symbols = await readSymbols(document.uri);
    return cards.flatMap((card): vscode.CodeLens[] => {
      if (card?.type === "symbol") {
        const symbol = symbols.find((symbol) => symbol.label === card.symbol);

        if (symbol) {
          invariant(symbol.range, "Symbol range is missing");
          let range = symbol.range;
          range = new vscode.Range(range.start, range.start);

          const locationLink: vscode.LocationLink = {
            targetUri: document.uri,
            targetRange: range,
          };

          const c: vscode.Command = {
            command: "app-explorer.navigate",
            title: `${card.title}$(link-external)`,
            arguments: [card.miroLink, locationLink],
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
