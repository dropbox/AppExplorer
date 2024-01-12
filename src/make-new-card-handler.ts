import * as vscode from "vscode";
import { HandlerContext } from "./extension";
import { getRelativePath } from "./get-relative-path";
import { CardData } from "./EventTypes";
import { selectRangeInEditor } from "./extension";
import { getGitHubUrl } from "./get-github-url";

const cancel = Symbol("cancel");

const rangeOf = (symbol: vscode.SymbolInformation | vscode.DocumentSymbol) => {
  if ("location" in symbol) {
    return symbol.location.range;
  }
  return symbol.range;
};

export const makeNewCardHandler = ({
  waitForConnections,
  emit,
}: HandlerContext) =>
  async function () {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      const uri = getRelativePath(editor.document.uri);
      if (!uri) {
        return;
      }
      await waitForConnections();

      const cardData = await makeCardData(editor);

      if (cardData) {
        emit("newCard", cardData);
      }
    }
  };

async function makeCardData(
  editor: vscode.TextEditor
): Promise<CardData | null> {
  const document = editor.document;
  const position = editor.selection.active;

  const symbol = await showSymbolPicker(editor, position);
  if (symbol === cancel) {
    return null;
  }

  if (symbol) {
    selectRangeInEditor(rangeOf(symbol), editor);
  }
  const lineAt = document.lineAt(position);
  const title = await vscode.window.showInputBox({
    title: "Card Title 2/2",
    prompt: "Card title" + (symbol ? ` (${symbol.name})` : ""),
    value: symbol?.name ?? document.getText(lineAt.range),
  });
  if (!title) {
    return null;
  }

  let def: vscode.LocationLink = {
    targetUri: document.uri,
    targetRange: lineAt.range,
  };
  if (symbol) {
    let uri = document.uri;
    if ("location" in symbol) {
      uri = symbol.location.uri;
    }

    def = {
      targetUri: uri,
      targetRange: rangeOf(symbol),
    };
  }

  const path = getRelativePath(def.targetUri)!;

  return {
    title,
    path,
    symbol: symbol?.name,
    codeLink: await getGitHubUrl(def),
    symbolPosition: def.targetRange,
  };
}

async function showSymbolPicker(
  editor: vscode.TextEditor,
  position: vscode.Position
): Promise<
  vscode.SymbolInformation | vscode.DocumentSymbol | undefined | typeof cancel
> {
  const definitions =
    (await vscode.commands.executeCommand<
      Array<vscode.LocationLink | vscode.Location>
    >("vscode.executeDefinitionProvider", editor.document.uri, position)) ?? [];

  const symbols =
    (await vscode.commands.executeCommand<
      Array<vscode.SymbolInformation | vscode.DocumentSymbol>
    >("vscode.executeDocumentSymbolProvider", editor.document.uri)) || [];

  const handleChildren = (
    symbol: vscode.SymbolInformation | vscode.DocumentSymbol
  ): Array<vscode.SymbolInformation | vscode.DocumentSymbol> => {
    if ("children" in symbol) {
      return [symbol, ...symbol.children.flatMap(handleChildren)];
    } else {
      return [symbol];
    }
  };

  const sortedSymbols = [...symbols].flatMap(handleChildren).sort((a, b) => {
    if (rangeOf(a).contains(position)) {
      return -1;
    }
    if (rangeOf(b).contains(position)) {
      return 1;
    }
    return 0;
  });

  type TaggedQuickPickItem<T, D> = vscode.QuickPickItem & {
    type: T;
    target: D;
  };
  const none: TaggedQuickPickItem<"none", undefined> = {
    type: "none",
    label: "(None)",
    target: undefined,
  };
  type OptionTypes =
    | typeof none
    | TaggedQuickPickItem<"definition", vscode.LocationLink | vscode.Location>
    | TaggedQuickPickItem<
        "symbol",
        vscode.SymbolInformation | vscode.DocumentSymbol
      >;

  const items: Array<OptionTypes> = [
    none,
    ...definitions.map((def, index) => {
      if ("uri" in def) {
        return {
          type: "definition",
          label: `(reference) ${def.uri.path} ${def.range.start.line}-${def.range.end.line}`,
          target: def,
          picked: index === 0,
        } as const;
      } else {
        const text = editor.document.getText(def.originSelectionRange);
        return {
          type: "definition",
          label: `(reference) ${text} ${def.targetUri.path}`,
          target: def,
          picked: index === 0,
        } as const;
      }
    }),
    ...sortedSymbols.map(
      (
        symbol
      ): TaggedQuickPickItem<
        "symbol",
        vscode.SymbolInformation | vscode.DocumentSymbol
      > => {
        let range;
        if ("location" in symbol) {
          range = symbol.location.range;
        } else {
          range = symbol.range;
        }

        return {
          type: "symbol",
          label: `(symbol) ${symbol.name}`,
          target: symbol,
          picked: range.start.line === position.line,
        } as const;
      }
    ),
  ];

  const selected = await vscode.window.showQuickPick(items, {
    title: "Choose a symbol step 1/2",
    placeHolder: `Choose a symbol to anchor the card to`,
    onDidSelectItem: (item: OptionTypes) => {
      if (item.type === "symbol") {
        selectRangeInEditor(rangeOf(item.target), editor);
      }
      if (item.type === "definition") {
        if ("uri" in item.target) {
          selectRangeInEditor(item.target.range, editor);
        } else {
          selectRangeInEditor(
            item.target.originSelectionRange ??
              item.target.targetSelectionRange ??
              item.target.targetRange,
            editor
          );
        }
      }
    },
  });
  if (!selected) {
    return cancel;
  } else if (selected === none) {
    return; /* Do not attach to a symbol, just use the line number */
  } else if (selected.type === "definition") {
    const def = selected.target;
    if ("uri" in def) {
      let editor = vscode.window.visibleTextEditors.find((editor) => {
        return editor.document.uri.toString() === def.uri.toString();
      });
      if (!editor) {
        const document = await vscode.workspace.openTextDocument(def.uri);
        editor = await vscode.window.showTextDocument(document);
      }
      selectRangeInEditor(def.range, editor);
      const text = editor.document.getText(def.range);
      const symbols = await vscode.commands.executeCommand<
        vscode.SymbolInformation[]
      >("vscode.executeDocumentSymbolProvider", editor.document.uri);

      return symbols.find((s) => s.name === text);
    }
  } else if (selected.type === "symbol") {
    return selected.target;
  }
  return;
}
