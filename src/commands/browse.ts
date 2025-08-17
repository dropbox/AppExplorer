import * as vscode from "vscode";
import { CardData } from "../EventTypes";
import { HandlerContext, selectRangeInEditor } from "../extension";
import { getGitHubUrl } from "../get-github-url";
import { getRelativePath } from "../get-relative-path";
import { LocationFinder } from "../location-finder";
import { createDebug } from "../utils/create-debug";
import { CHECKPOINT } from "../utils/log-checkpoint";
import { SymbolAnchor } from "./create-card";
const debug = createDebug("app-explorer:browse");

export async function selectBoard(cardStorage: HandlerContext["cardStorage"]) {
  const boards = cardStorage
    .listBoardIds()
    .map((boardId) => cardStorage.getBoard(boardId)!);
  const items = boards.map(
    (board): vscode.QuickPickItem => ({
      label:
        board.name === board.boardId
          ? `Board ID: ${board.boardId}`
          : board.name,
      detail: `${Object.keys(board.cards).length} cards`,
    }),
  );
  if (items.length === 1) {
    return boards[0];
  } else {
    debug(CHECKPOINT.quickPick("Choose a board"));
    const selected = await vscode.window.showQuickPick(items, {
      title: "Choose a board",
      onDidSelectItem: (item) => {
        debug(CHECKPOINT.selected(item));
      },
    });
    if (selected) {
      const index = items.indexOf(selected);
      return boards[index];
    }
  }
  return null;
}

export const makeBrowseHandler = (context: HandlerContext) =>
  async function () {
    const { cardStorage } = context;
    debug("Browsing cards...", {
      connectedBoards: cardStorage.getConnectedBoards(),
      cardsByBoard: cardStorage.getCardsByBoard(),
    });
    const navigateTo = cardStorage.navigateTo;
    const locationFinder = new LocationFinder();
    type CardQuickPickItem = vscode.QuickPickItem & {
      miroLink: string;
    };

    const board = await selectBoard(cardStorage);
    if (!board) {
      return;
    }

    const activeEditor = vscode.window.activeTextEditor;
    const curentPath = activeEditor
      ? getRelativePath(activeEditor.document.uri)
      : null;

    const originalSelection = activeEditor?.selection;

    const boardSeparator = {
      kind: vscode.QuickPickItemKind.Separator,
      label:
        board.name === board.boardId
          ? `Board ID: ${board.boardId}`
          : board.name,
    } as CardQuickPickItem;

    const items: CardQuickPickItem[] = [boardSeparator].concat(
      ...Object.values(board.cards)
        .sort((a, b) => {
          if (a.path !== b.path) {
            if (a.path === curentPath) {
              return -1;
            }
            if (b.path === curentPath) {
              return 1;
            }
          }
          return a.path.localeCompare(b.path) || a.title.localeCompare(b.title);
        })
        .map((card): CardQuickPickItem => {
          let description: string = "[ Missing card type ]";
          if (card.type === "symbol") {
            description =
              card.symbol +
              (card.status === "disconnected"
                ? "$(debug-disconnect)"
                : "$(preview)");
          }
          return {
            label: card.title.trim(),
            detail: card.path,
            description,
            miroLink: card.miroLink!,
          };
        }),
    );

    debug(CHECKPOINT.quickPick("Browse Cards"));
    const selected = await vscode.window.showQuickPick(items, {
      title: "Browse Cards",
      ignoreFocusOut: true,
      // placeHolder: `Choose a symbol to anchor the card to`,
      onDidSelectItem: async (item: CardQuickPickItem) => {
        debug(CHECKPOINT.selected(item.miroLink));
        const card = cardStorage.getCardByLink(item.miroLink);
        if (card && card.miroLink) {
          await cardStorage.socket.emitWithAck(
            "hoverCard",
            card.boardId,
            card.miroLink!,
          );
          await navigateTo(card, true);
        }
      },
    });
    if (!selected && originalSelection) {
      const editor = await vscode.window.showTextDocument(
        activeEditor.document.uri,
      );
      selectRangeInEditor(originalSelection, editor);
    } else if (selected) {
      const card = cardStorage.getCardByLink(selected.miroLink);
      if (card) {
        await context.cardStorage.socket.emitWithAck(
          "selectCard",
          card.boardId,
          card.miroLink!,
        );
        const dest = await locationFinder.findCardDestination(card);
        const status = (await goToCardCode(card))
          ? "connected"
          : "disconnected";
        if (card.miroLink) {
          let codeLink: string | null = null;
          const activeEditor = vscode.window.activeTextEditor;
          if (dest) {
            if (activeEditor) {
              const uri = activeEditor.document.uri;
              const selection =
                status === "connected"
                  ? new vscode.Range(
                      activeEditor.selection.start,
                      activeEditor.selection.end,
                    )
                  : new vscode.Range(
                      new vscode.Position(0, 0),
                      new vscode.Position(0, 0),
                    );

              const def: vscode.LocationLink = {
                targetUri: uri,
                targetRange: selection,
              };
              codeLink = await getGitHubUrl(def);
            }
          }

          await context.cardStorage.socket.emitWithAck(
            "cardStatus",
            card.boardId,
            {
              miroLink: card.miroLink,
              status,
              codeLink,
            },
          );
        }
      }
    }
  };

export async function findCardDestination(
  card: CardData,
): Promise<SymbolAnchor | vscode.Uri | null> {
  const locationFinder = new LocationFinder();
  return locationFinder.findCardDestination(card);
}

export async function goToCardCode(card: CardData, preview = false) {
  const locationFinder = new LocationFinder();
  const symbol = await locationFinder.findCardDestination(card);

  if (symbol && "range" in symbol) {
    const editor = await vscode.window.showTextDocument(symbol.uri, {
      preview,
      preserveFocus: preview,
    });
    selectRangeInEditor(symbol.range, editor);
    return true;
  } else if (symbol) {
    await vscode.window.showTextDocument(symbol, {
      preview,
      preserveFocus: preview,
    });
    // The card still attaches to a file, but not a symbol, so even though it
    // navigated to a file, it's NOT considered connected.
    return false;
  }
  vscode.window.showWarningMessage(`Unable to open ${card.path}`);
  return false;
}
