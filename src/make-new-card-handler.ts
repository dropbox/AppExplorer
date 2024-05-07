import * as vscode from "vscode";
import { HandlerContext } from "./extension";
import { getRelativePath } from "./get-relative-path";
import { CardData } from "./EventTypes";
import { selectRangeInEditor } from "./extension";
import { getGitHubUrl } from "./get-github-url";

function invariant(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

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

export async function makeCardData(
  editor: vscode.TextEditor
): Promise<CardData | null> {
  const document = editor.document;
  const position = editor.selection.active;

  const anchor = await showSymbolPicker(editor, position);
  if (anchor === cancel || !anchor) {
    return null;
  }

  selectRangeInEditor(anchor.range, editor);
  const lineAt = document.lineAt(position);
  const title = await vscode.window.showInputBox({
    title: "Card Title 2/2",
    prompt: "Card title" + (anchor ? ` (${anchor.label})` : ""),
    value: anchor?.label ?? document.getText(lineAt.range),
  });
  if (!title) {
    return null;
  }

  let def: vscode.LocationLink = {
    targetUri: document.uri,
    targetRange: lineAt.range,
  };
  if (anchor && anchor.uri) {
    const uri = anchor.uri;

    invariant(anchor.range, "Symbol must have a range");

    def = {
      targetUri: uri,
      targetRange: anchor.range,
    };
  }

  const path = getRelativePath(def.targetUri)!;

  const cardData = {
    title,
    path,
    symbol: anchor.label,
    codeLink: await getGitHubUrl(def),
    status: 'disconnected',
  } as const;
  return cardData;
}

async function showSymbolPicker(
  editor: vscode.TextEditor,
  position: vscode.Position
): Promise<Anchor | undefined | typeof cancel> {
  const sortedSymbols = await readSymbols(editor.document.uri, position);

  type TaggedQuickPickItem<T, D> = vscode.QuickPickItem & {
    type: T;
    target: D;
  };
  const none: TaggedQuickPickItem<"none", undefined> = {
    type: "none",
    label: "(None)",
    target: undefined,
  };
  type SymbolOption = TaggedQuickPickItem<"symbol", Anchor>;

  type OptionTypes = typeof none | SymbolOption;

  const items: Array<OptionTypes> = [
    none,
    ...sortedSymbols.map((symbol): SymbolOption => {
      const item: SymbolOption = {
        type: symbol.type,
        label: `(symbol) ${symbol.label}`,
        target: symbol,
        picked: symbol.range?.start.line === position.line,
      };
      return item;
    }),
  ];

  const selected = await vscode.window.showQuickPick(items, {
    title: "Choose a symbol step 1/2",
    placeHolder: `Choose a symbol to anchor the card to`,
    onDidSelectItem: (item: OptionTypes) => {
      if (item.target) {
        selectRangeInEditor(item.target.range, editor);
      }
    },
  });
  if (!selected) {
    return cancel;
  } else if (selected === none) {
    return; /* Do not attach to a symbol, just use the line number */
  } else if (selected.type === "symbol") {
    return selected.target;
  }
  return;
}

type Anchor = {
  type: "symbol";
  label: string;
  range: vscode.Range;
  target: vscode.SymbolInformation | vscode.DocumentSymbol;
  uri: vscode.Uri;
};

export async function readSymbols(
  uri: vscode.Uri,
  position?: vscode.Position
): Promise<Array<Anchor>> {
  const symbols =
    (await vscode.commands.executeCommand<
      Array<vscode.SymbolInformation | vscode.DocumentSymbol>
    >("vscode.executeDocumentSymbolProvider", uri)) || [];

  const sortedSymbols = [...symbols].sort((a, b) => {
    if (position && rangeOf(a).contains(position)) {
      return -1;
    }
    if (position && rangeOf(b).contains(position)) {
      return 1;
    }
    return 0;
  });
  const allSymbols = sortedSymbols.flatMap(function optionFromSymbol(
    this: void | undefined,
    symbol
  ): Anchor[] {
    let children: Array<Anchor> = [];
    if ("children" in symbol) {
      children = symbol.children.flatMap((s) =>
        optionFromSymbol({
          ...s,
          name: `${symbol.name}/${s.name}`,
        })
      );
    }
    let range;
    if ("location" in symbol) {
      range = symbol.location.range;
      uri = symbol.location.uri;
    } else {
      range = symbol.range;
    }

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

  return allSymbols;
}
