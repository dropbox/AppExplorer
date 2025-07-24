import * as vscode from "vscode";
import { CardData } from "../EventTypes";
import { HandlerContext, selectRangeInEditor } from "../extension";
import { getGitHubUrl } from "../get-github-url";
import { getRelativePath } from "../get-relative-path";
import { LocationFinder } from "../location-finder";
import { SymbolAnchor } from "./create-card";

export async function selectBoard(cardStorage: HandlerContext["cardStorage"]) {
  const boards = cardStorage
    .listWorkspaceBoards()
    .map((boardId) => cardStorage.getBoard(boardId)!);
  const items = boards.map(
    (board): vscode.QuickPickItem => ({
      label: board.name === board.id ? `Board ID: ${board.id}` : board.name,
      detail: `${Object.keys(board.cards).length} cards`,
    }),
  );
  if (items.length === 1) {
    return boards[0];
  } else {
    const selected = await vscode.window.showQuickPick(items, {
      title: "Choose a board",
    });
    if (selected) {
      const index = items.indexOf(selected);
      return boards[index];
    }
  }
  return null;
}

export const makeBrowseHandler = (
  context: HandlerContext,
  navigateToCard: (card: CardData, preview?: boolean) => Promise<boolean>,
) =>
  async function () {
    const { cardStorage } = context;
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
      label: board.name === board.id ? `Board ID: ${board.id}` : board.name,
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
          let description: string;
          if (card.type === "group") {
            description = "Group";
          } else {
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

    const selected = await vscode.window.showQuickPick(items, {
      title: "Browse Cards",
      ignoreFocusOut: true,
      // placeHolder: `Choose a symbol to anchor the card to`,
      onDidSelectItem: async (item: CardQuickPickItem) => {
        const card = cardStorage.getCardByLink(item.miroLink);
        if (card && card.miroLink) {
          // Use universal query method through WorkspaceCardStorageProxy
          await context.cardStorage.query(
            card.boardId,
            "hoverCard",
            card.miroLink,
          );
          await navigateToCard(card, true);
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
        // Use universal query method through WorkspaceCardStorageProxy
        await context.cardStorage.query(
          card.boardId,
          "selectCard",
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

          // Use universal query method through WorkspaceCardStorageProxy
          await context.cardStorage.query(card.boardId, "cardStatus", {
            miroLink: card.miroLink,
            status,
            codeLink,
          });
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
