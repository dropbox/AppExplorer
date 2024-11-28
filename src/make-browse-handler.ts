import * as vscode from "vscode";
import { HandlerContext, selectRangeInEditor } from "./extension";
import { CardData } from "./EventTypes";
import { getRelativePath } from "./get-relative-path";
import { SymbolAnchor, readSymbols } from "./make-new-card-handler";
import { getGitHubUrl } from "./get-github-url";

export const makeBrowseHandler = ({ cardStorage, sockets }: HandlerContext) =>
  async function () {
    type CardQuickPickItem = vscode.QuickPickItem & {
      miroLink: string;
    };

    const activeEditor = vscode.window.activeTextEditor;
    const curentPath = activeEditor
      ? getRelativePath(activeEditor.document.uri)
      : null;

    const items: CardQuickPickItem[] = cardStorage
      .listBoardIds()
      .flatMap((boardId) => {
        const board = cardStorage.getBoard(boardId)!;

        const boardSeparator = {
          kind: vscode.QuickPickItemKind.Separator,
          label: board.name === board.id ? `Board ID: ${board.id}` : board.name,
        } as CardQuickPickItem;

        return [boardSeparator].concat(
          ...Object.values(board.cards)
            .sort((a, b) => {
              if (a.path !== b.path) {
                if (a.path === curentPath) return -1;
                if (b.path === curentPath) return 1;
              }
              return (
                a.path.localeCompare(b.path) || a.title.localeCompare(b.title)
              );
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
      });

    const selected = await vscode.window.showQuickPick(items, {
      title: "Browse Cards",
      // placeHolder: `Choose a symbol to anchor the card to`,
      onDidSelectItem: (item: CardQuickPickItem) => {
        const card = cardStorage.getCardByLink(item.miroLink);
        if (card && card.miroLink) {
          const socket = sockets.get(card.boardId)!;
          socket.emit("hoverCard", card.miroLink);
        }
      },
    });

    if (selected) {
      const card = cardStorage.getCardByLink(selected.miroLink);
      if (card) {
        const socket = sockets.get(card.boardId)!;
        socket.emit("selectCard", card.miroLink!);
        const dest = await findCardDestination(card);
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

          socket.emit("cardStatus", {
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
  if (card.path) {
    const path = card.path[0] === "/" ? card.path.slice(1) : card.path;
    // Get the root directory's URI

    // This reduce acts like a find(), returning the first promise with a value.
    return (vscode.workspace.workspaceFolders ?? []).reduce(
      async (result: Promise<SymbolAnchor | vscode.Uri | null>, folder) => {
        const dest = await result;
        if (dest != null) {
          return dest;
        }

        const rootUri = folder.uri;
        // Append the relative path to the root directory's URI
        const uri = rootUri.with({ path: rootUri.path + "/" + path });
        // Check if this URI exists
        try {
          const stat = await vscode.workspace.fs.stat(uri);

          if (stat.type !== vscode.FileType.File) {
            return null;
          }
        } catch (e) {
          console.error(e);
          // stat throws if the file doesn't exist.
          return null;
        }

        if ("symbol" in card) {
          const symbols = await readSymbols(uri);
          const symbol = symbols.find((symbol) => symbol.label === card.symbol);
          return symbol ?? uri;
        }
        return uri;
      },
      Promise.resolve(null),
    );
  }
  return null;
}

export async function goToCardCode(card: CardData) {
  const symbol = await findCardDestination(card);
  if (symbol && "range" in symbol) {
    const editor = await vscode.window.showTextDocument(symbol.uri);
    selectRangeInEditor(symbol.range, editor);
    return true;
  } else if (symbol) {
    await vscode.window.showTextDocument(symbol);
    // The card still attaches to a file, but not a symbol, so even though it
    // navigated to a file, it's NOT considered connected.
    return false;
  }
  vscode.window.showWarningMessage(`Unable to open ${card.path}`);
  return false;
}
