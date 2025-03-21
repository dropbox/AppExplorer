import * as vscode from "vscode";
import { SymbolAnchor, GroupAnchor } from "./commands/create-card";
import { CardData } from "./EventTypes";

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
          if (dest != null) {
            return dest;
          }

          const rootUri = folder.uri;
          const uri = rootUri.with({ path: rootUri.path + "/" + path });

          try {
            const stat = await vscode.workspace.fs.stat(uri);
            if (stat.type !== vscode.FileType.File) {
              return null;
            }
          } catch (e) {
            console.error(e);
            return null;
          }

          if ("symbol" in card) {
            const symbols = await this.findSymbolsInDocument(uri);
            const symbol = symbols.find(
              (symbol) => symbol.label === card.symbol,
            );
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
