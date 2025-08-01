import * as vscode from "vscode";
import { CardData } from "../EventTypes";
import { HandlerContext, selectRangeInEditor } from "../extension";
import { getGitHubUrl } from "../get-github-url";
import { getRelativePath } from "../get-relative-path";
import { LocationFinder } from "../location-finder";
import { promiseEmit } from "../utils/promise-emit";

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

export async function selectConnectedBoard({ cardStorage }: HandlerContext) {
  const connectedBoards = cardStorage.getConnectedBoards();
  if (connectedBoards.length === 1) {
    return connectedBoards[0];
  } else {
    const boards = connectedBoards.map((k) => cardStorage.getBoard(k)!);

    const items = boards.map((board): vscode.QuickPickItem => {
      return {
        label:
          board.name === board.boardId
            ? `Board ID: ${board.boardId}`
            : board.name,
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
    return connectedBoards[index];
  }
}

export const makeNewCardHandler = (context: HandlerContext) =>
  async function (options: CreateCardOptions = {}) {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      const uri = getRelativePath(editor.document.uri);
      if (!uri) {
        return;
      }
      await context.waitForConnections();

      const boardId = await selectConnectedBoard(context);
      if (boardId) {
        const cardData = await makeCardData(editor, boardId, {
          canPickMany: false,
        });
        if (cardData) {
          await promiseEmit(
            context.cardStorage.socket,
            "newCards",
            boardId,
            cardData,
            {
              connect: options.connect,
            },
          );
        }
        return cardData;
      }
    }
    return [];
  };

export async function makeCardData(
  editor: vscode.TextEditor,
  boardId: string,
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
        boardId,
        title: anchor.label,
        path,
        symbol: anchor.label,
        codeLink: await getGitHubUrl(def),
        status: "connected",
      };
    }),
  );

  cards[0].title = title;

  return cards;
}

async function showSymbolPicker(
  editor: vscode.TextEditor,
  position: vscode.Position,
  options?: {
    canPickMany?: boolean;
  },
): Promise<Anchor[] | undefined | typeof cancel> {
  const locationFinder = new LocationFinder();
  const allSymbols = await locationFinder.findSymbolsInDocument(
    editor.document.uri,
  );
  const selectedSymbol = await locationFinder.findSymbolInPosition(
    editor.document.uri,
    position,
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
