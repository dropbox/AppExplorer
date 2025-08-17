import * as vscode from "vscode";
import { invariant } from "./commands/create-card";
import { HandlerContext } from "./extension";
import { getRelativePath } from "./get-relative-path";
import { LocationFinder } from "./location-finder";
import { createDebug } from "./utils/create-debug";
const debug = createDebug("app-explorer:lens");

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
    const locationFinder = new LocationFinder();
    const symbols = await locationFinder.findSymbolsInDocument(document.uri);
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
            title: `$(app-explorer) ${card.title}`,
            arguments: [card.miroLink, locationLink],
          };

          const codeLens = new vscode.CodeLens(range, c);
          return [codeLens];
        } else {
          // debug(`Symbol ${card.symbol} not found in ${path}`);
          // debug("symbols", symbols);
        }
      } else {
        debug("Not a symbol card", card);
      }
      return [];
    });
  }
}
