import * as vscode from "vscode";
import { HandlerContext } from "./extension";
import { CardData } from "./EventTypes";

export const makeBrowseHandler = ({ allCards, emit }: HandlerContext) =>
  async function () {
    type CardQuickPickItem = vscode.QuickPickItem & {
      miroLink: string;
    };
    const items: CardQuickPickItem[] = [...allCards.values()].map(
      (card: CardData) => {
        return {
          label: card.title.trim(),
          detail: card.path,
          description: card.symbol,
          miroLink: card.miroLink!,
        };
      }
    );

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

      if (card && card.path) {
        const { path } = card;
        // Get the root directory's URI
        const rootUri = vscode.workspace.workspaceFolders?.[0].uri;
        if (rootUri) {
          // Append the relative path to the root directory's URI
          const uri = rootUri.with({ path: rootUri.path + "/" + path });
          await vscode.window.showTextDocument(uri);
        }
      }
    }

    console.log("selected", selected);
  };
