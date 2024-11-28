import * as vscode from "vscode";
import { HandlerContext } from "./extension";
import { getRelativePath } from "./get-relative-path";
import { CardData } from "./EventTypes";
import { selectRangeInEditor } from "./extension";
import { getGitHubUrl } from "./get-github-url";

export class UnreachableError extends Error {
  constructor(item: never) {
    super(`Unexpected value found at runtime: ${item as string}`);
    this.name = "UnreachableError";
  }
}

export function invariant(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

const cancel = Symbol("cancel");

type CreateCardOptions = {
  connect?: string[];
};

export const makeNewCardHandler = ({
  waitForConnections,
  sockets,
  cardStorage,
  emit,
}: HandlerContext) =>
  async function (options: CreateCardOptions = {}) {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      const uri = getRelativePath(editor.document.uri);
      if (!uri) {
        return;
      }
      await waitForConnections();
      const connectedBoardIds = [...sockets.keys()];
      let boardId: string | null = null;
      if (connectedBoardIds.length === 1) {
        boardId = connectedBoardIds[0];
      } else if (connectedBoardIds.length > 1) {
        const boards = [...sockets.keys()].map((k) => cardStorage.getBoard(k)!);

        const items = boards.map((board): vscode.QuickPickItem => {
          return {
            label:
              board.name === board.id ? `Board ID: ${board.id}` : board.name,
            detail: `${Object.keys(board.cards).length} cards`,
          };
        });

        const selected = await vscode.window.showQuickPick(items, {
          title: "Choose a board",
        });
        if (!selected) {
          return;
        }
        const index = items.indexOf(selected);
        boardId = connectedBoardIds[index];
      }

      if (boardId) {
        const cardData = await makeCardData(editor, {
          canPickMany: false,
        });

        if (cardData) {
          sockets.get(boardId);
          emit("newCards", cardData, { connect: options.connect });
        }
      }
    }
  };

export async function makeCardData(
  editor: vscode.TextEditor,
  options?: {
    canPickMany?: boolean;
    defaultTitle?: string;
  },
): Promise<CardData[] | null> {
  const document = editor.document;
  const position = editor.selection.active;

  const chosenSymbols = await showSymbolPicker(editor, position, {
    canPickMany: options?.canPickMany,
  });
  if (
    chosenSymbols === cancel ||
    !chosenSymbols ||
    chosenSymbols.length === 0
  ) {
    return null;
  }

  const makeCardGroup = chosenSymbols.length > 1;

  const anchor = chosenSymbols[0];
  const lineAt = document.lineAt(position);
  const title = await vscode.window.showInputBox({
    title: "Card Title 2/2",
    prompt: `Card title (${anchor.label})`,
    value: options?.defaultTitle ?? anchor.label,
  });
  if (!title) {
    return null;
  }

  const def: vscode.LocationLink = {
    targetUri: document.uri,
    targetRange: lineAt.range,
  };
  const path = getRelativePath(def.targetUri)!;

  const cards = await Promise.all(
    chosenSymbols.map(async (anchor): Promise<CardData> => {
      const def: vscode.LocationLink = {
        targetUri: anchor.uri,
        targetRange: anchor.range,
      };
      const path = getRelativePath(def.targetUri)!;
      return {
        type: "symbol",
        title: anchor.label,
        path,
        symbol: anchor.label,
        codeLink: await getGitHubUrl(def),
        status: "disconnected",
      };
    }),
  );

  if (makeCardGroup) {
    const rootCard: CardData = {
      type: "group",
      title,
      path,
      status: "disconnected",
    };
    cards.unshift(rootCard);
  } else {
    cards[0].title = title;
  }

  return cards;
}

async function showSymbolPicker(
  editor: vscode.TextEditor,
  position: vscode.Position,
  options?: {
    canPickMany?: boolean;
  },
): Promise<Anchor[] | undefined | typeof cancel> {
  const allSymbols = await readSymbols(editor.document.uri);

  const selectedSymbol = allSymbols.reduce(
    (acc, symbol) => {
      if (symbol.range.contains(position)) {
        if (!acc || acc.range.contains(symbol.range)) {
          // Symbol is smaller than the current selection
          return symbol;
        }

        return symbol;
      }
      return acc;
    },
    null as null | SymbolAnchor,
  );
  if (options?.canPickMany && selectedSymbol) {
    allSymbols.sort((a, b) => {
      if (a.label === selectedSymbol.label) {
        return -1;
      }
      if (b.label === selectedSymbol.label) {
        return 1;
      }
      return 0;
    });
  }

  type TaggedQuickPickItem<T, D> = vscode.QuickPickItem & {
    type: T;
    target: D;
  };
  type SymbolOption = TaggedQuickPickItem<"symbol", Anchor>;

  type OptionType = SymbolOption;

  const items: Array<OptionType> = [
    ...allSymbols
      .flatMap((symbol): SymbolOption[] => {
        if (symbol.range.contains(position)) {
          const item: SymbolOption = {
            type: symbol.type,
            label: symbol.label,
            target: symbol,
            picked: symbol.label === selectedSymbol?.label,
          };
          return [item];
        }
        return [];
      })
      .reverse(),
  ];

  const tmp = await vscode.window.showQuickPick(items, {
    title: "Choose a symbol step 1/2",
    placeHolder: `Choose a symbol to anchor the card to`,
    canPickMany: options?.canPickMany ?? true,
    matchOnDescription: true,
    onDidSelectItem: (item: OptionType) => {
      if (item.target) {
        selectRangeInEditor(item.target.range, editor);
      }
    },
  });
  let selected: OptionType[];
  if (!tmp) {
    return cancel;
  } else if (Array.isArray(tmp)) {
    selected = tmp;
  } else {
    selected = [tmp];
  }

  return selected.map((item): Anchor => {
    return item.target;
  });
}

export type SymbolAnchor = {
  type: "symbol";
  label: string;
  range: vscode.Range;
  target: vscode.SymbolInformation | vscode.DocumentSymbol;
  uri: vscode.Uri;
};

export type GroupAnchor = {
  type: "group";
  label: string;
  range: vscode.Range;
  uri: vscode.Uri;
};

export type Anchor = SymbolAnchor | GroupAnchor;

export async function readSymbols(
  uri: vscode.Uri,
): Promise<Array<SymbolAnchor>> {
  const symbols =
    (await vscode.commands.executeCommand<
      Array<vscode.SymbolInformation | vscode.DocumentSymbol>
    >("vscode.executeDocumentSymbolProvider", uri)) || [];

  const sortedSymbols = [...symbols];
  const allSymbols = sortedSymbols.flatMap(function optionFromSymbol(
    this: void | undefined,
    symbol,
  ): SymbolAnchor[] {
    let children: Array<SymbolAnchor> = [];
    if ("children" in symbol) {
      children = symbol.children.flatMap((s) =>
        optionFromSymbol({
          ...s,
          name: `${symbol.name}/${s.name}`,
        }),
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
