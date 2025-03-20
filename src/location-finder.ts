import * as vscode from "vscode";
import { SymbolAnchor, GroupAnchor } from "./commands/create-card";

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
