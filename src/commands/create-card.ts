import * as vscode from "vscode";
import { CardData } from "../EventTypes";
import { HandlerContext, selectRangeInEditor } from "../extension";
import { getGitHubUrl } from "../get-github-url";
import { getRelativePath } from "../get-relative-path";
import { LocationFinder } from "../location-finder";
import { createDebug } from "../utils/create-debug";
import { CHECKPOINT } from "../utils/log-checkpoint";
const debug = createDebug("app-explorer:create-card");

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
  boardId?: string;
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

    debug(CHECKPOINT.quickPick("Choose a board"));
    const selected = await vscode.window.showQuickPick(items, {
      title: "Choose a board",
      onDidSelectItem: (item) => {
        debug(CHECKPOINT.selected(item));
      },
    });
    debug("accepted value", CHECKPOINT.selected(selected || "(null)"));
    if (!selected) {
      return;
    }
    const index = items.indexOf(selected);
    return connectedBoards[index];
  }
}

export const makeNewCardHandler = (context: HandlerContext) =>
  async function (options: CreateCardOptions = {}, ...args: unknown[]) {
    debug(CHECKPOINT.createCard, { options, args });
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      const uri = getRelativePath(editor.document.uri);
      if (!uri) {
        return;
      }
      await context.waitForConnections();

      const boardId = options.boardId ?? (await selectConnectedBoard(context));
      if (boardId) {
        const cardData = await makeCardData(editor, boardId, {
          canPickMany: false,
        });
        if (cardData) {
          await context.cardStorage.socket.emitWithAck(
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
  const position = editor.selection.active;

  const chosenSymbols = await showSymbolPicker(editor, position);
  if (
    chosenSymbols === cancel ||
    !chosenSymbols ||
    chosenSymbols.length === 0
  ) {
    return null;
  }

  const anchor = chosenSymbols[0];
  debug(CHECKPOINT.quickPick("Card Title 2/2"));
  const title = await vscode.window.showInputBox({
    title: "Card Title 2/2",
    prompt: `Card title (${anchor.label})`,
    value: options?.defaultTitle ?? anchor.label,
  });
  if (!title) {
    return null;
  }

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
): Promise<Anchor[] | undefined | typeof cancel> {
  const locationFinder = new LocationFinder();
  const selectedSymbol = await locationFinder.findSymbolInPosition(
    editor.document.uri,
    position,
  );

  type TaggedQuickPickItem<T, D> = vscode.QuickPickItem & {
    type: T;
    target: D;
  };
  type SymbolOption = TaggedQuickPickItem<"symbol", Anchor>;

  type OptionType = SymbolOption;

  const items: Array<OptionType> = (
    await locationFinder.findSymbolsAroundCursor(editor.document.uri, position)
  )
    .map((symbol) => {
      const item: SymbolOption = {
        type: symbol.type,
        label: symbol.label,
        target: symbol,
        picked: symbol.label === selectedSymbol?.label,
      };
      return item;
    })
    .reverse();

  debug(CHECKPOINT.quickPick("Choose a symbol step 1/2"));
  const tmp = await vscode.window.showQuickPick(items, {
    title: "Choose a symbol step 1/2",
    placeHolder: `Choose a symbol to anchor the card to`,
    matchOnDescription: true,
    onDidSelectItem: (item: OptionType) => {
      debug(CHECKPOINT.selected(item));
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
