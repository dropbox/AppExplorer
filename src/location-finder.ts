import createDebug from "debug";
import * as vscode from "vscode";
import { SymbolAnchor } from "./commands/create-card";
import { CardData } from "./EventTypes";

const debug = createDebug("app-explorer:location-finder");

export class LocationFinder {
  async findSymbolsInDocument(uri: vscode.Uri): Promise<Array<SymbolAnchor>> {
    const symbols =
      (await vscode.commands.executeCommand<
        Array<vscode.SymbolInformation | vscode.DocumentSymbol>
      >("vscode.executeDocumentSymbolProvider", uri)) || [];

    return this.flattenSymbols(symbols, uri);
  }

  async findSymbolInPosition(
    uri: vscode.Uri,
    position: vscode.Position,
  ): Promise<SymbolAnchor | null> {
    const symbols = await this.findSymbolsInDocument(uri);
    return symbols.reduce(
      (acc, symbol) => {
        if (symbol.range.contains(position)) {
          if (!acc || acc.range.contains(symbol.range)) {
            return symbol;
          }
        }
        return acc;
      },
      null as SymbolAnchor | null,
    );
  }

  async findCardDestination(
    card: CardData,
  ): Promise<SymbolAnchor | vscode.Uri | null> {
    if (card.path) {
      const path = card.path[0] === "/" ? card.path.slice(1) : card.path;

      return (vscode.workspace.workspaceFolders ?? []).reduce(
        async (result: Promise<SymbolAnchor | vscode.Uri | null>, folder) => {
          const dest = await result;
          if (dest !== null) {
            return dest;
          }

          const rootUri = folder.uri;
          const uri = vscode.Uri.joinPath(rootUri, path);

          try {
            const stat = await vscode.workspace.fs.stat(uri);
            if (stat.type !== vscode.FileType.File) {
              return null;
            }
          } catch (e) {
            debug(String(e));
            return null;
          }

          if ("symbol" in card) {
            // Retry symbol finding with delays to handle Language Server timing
            let symbols: SymbolAnchor[] = [];
            let attempts = 0;
            const maxAttempts = 5; // Increased from 1 to 5

            while (symbols.length === 0 && attempts < maxAttempts) {
              attempts++;
              symbols = await this.findSymbolsInDocument(uri);

              if (symbols.length === 0 && attempts < maxAttempts) {
                // Wait a bit for the Language Server to process the file
                await new Promise((resolve) => setTimeout(resolve, 1000)); // Increased from 500ms to 1000ms
              }
            }

            // Try to find symbol by exact match first, then by suffix match for nested symbols
            let symbol = symbols.find((symbol) => symbol.label === card.symbol);

            // If not found, try to find by suffix (e.g., "testMethod" matches "TestClass/testMethod")
            if (!symbol) {
              symbol = symbols.find((symbol) =>
                symbol.label.endsWith(`/${card.symbol}`),
              );
            }

            if (!symbol) {
              debug("❌ Symbol not found, returning URI only");
            }

            return symbol ?? uri;
          }
          return uri;
        },
        Promise.resolve(null),
      );
    }
    return null;
  }

  private flattenSymbols(
    symbols: Array<vscode.SymbolInformation | vscode.DocumentSymbol>,
    uri: vscode.Uri,
  ): SymbolAnchor[] {
    return symbols.flatMap((symbol): SymbolAnchor[] => {
      let children: Array<SymbolAnchor> = [];
      if ("children" in symbol) {
        children = symbol.children.flatMap((s) =>
          this.flattenSymbols(
            [{ ...s, name: `${symbol.name}/${s.name}` }],
            uri,
          ),
        );
      }

      const range = "location" in symbol ? symbol.location.range : symbol.range;

      return [
        {
          type: "symbol",
          label: symbol.name,
          range,
          uri,
          target: symbol,
        },
        ...children,
      ];
    });
  }
}
