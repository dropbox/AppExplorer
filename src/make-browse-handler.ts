import * as vscode from "vscode";
import { HandlerContext, selectRangeInEditor } from "./extension";
import { CardData } from "./EventTypes";
import { getRelativePath } from "./get-relative-path";
import { readSymbols } from "./make-new-card-handler";

export const makeBrowseHandler = ({ allCards, emit }: HandlerContext) =>
  async function () {
    type CardQuickPickItem = vscode.QuickPickItem & {
      miroLink: string;
    };

    const activeEditor = vscode.window.activeTextEditor;
    const curentPath = activeEditor
      ? getRelativePath(activeEditor.document.uri)
      : null;

    const items: CardQuickPickItem[] = [...allCards.values()]
      .sort((a, b) => {
        if (a.path !== b.path) {
          if (a.path === curentPath) return -1;
          if (b.path === curentPath) return 1;
        }
        return a.path.localeCompare(b.path) || a.title.localeCompare(b.title);
      })
      .map((card: CardData) => {
        return {
          label: card.title.trim(),
          detail: card.path,
          description:
            card.symbol +
            (card.status === "disconnected" ? "$(debug-disconnect)" : ""),
          miroLink: card.miroLink!,
        };
      });

    const selected = await vscode.window.showQuickPick(items, {
      title: "Browse Cards",
      // placeHolder: `Choose a symbol to anchor the card to`,
      onDidSelectItem: (item: CardQuickPickItem) => {
        const card = allCards.get(item.miroLink);
        if (card && card.miroLink) {
          emit("hoverCard", card.miroLink);
        }
      },
    });

    if (selected) {
      const card = allCards.get(selected.miroLink);
      if (card) {
        emit("selectCard", card.miroLink!);
      const status = (await goToCardCode(card)) ? "connected" : "disconnected";
      if (card.miroLink) {
        emit("cardStatus", {
          miroLink: card.miroLink,
          status,
        });
      }
      }
    }
  };

export async function goToCardCode(card: CardData) {
  if (card.path) {
    const { path } = card;
    // Get the root directory's URI
    const rootUri = vscode.workspace.workspaceFolders?.[0].uri;
    if (rootUri) {
      // Append the relative path to the root directory's URI
      const uri = rootUri.with({ path: rootUri.path + "/" + path });
      // Check if this URI exists
      try {
        if (
          (await vscode.workspace.fs.stat(uri)).type !== vscode.FileType.File
        ) {
          return false;
        }
      } catch (e) {
        // stat throws if the file doesn't exist.
        return false;
      }

      const editor = await vscode.window.showTextDocument(uri);
      let symbols = await readSymbols(editor);
      // It seems like when opening a new file, the symbols are not
      // immediately available.
      if (symbols.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        symbols = await readSymbols(editor);
      }
      const symbol = symbols.find((symbol) => symbol.label === card.symbol);
      if (symbol && symbol.range) {
        selectRangeInEditor(symbol.range, editor);
        return true;
      }
    }
  }
  return false;
}
