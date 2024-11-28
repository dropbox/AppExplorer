import * as vscode from "vscode";
import { Socket } from "socket.io";
import { getRelativePath } from "./get-relative-path";
import { CardStorage } from "./card-storage";

export class StatusBarManager {
  public statusBar: vscode.StatusBarItem;

  constructor(
    private sockets: Map<string, Socket>,
    private allCards: CardStorage,
    context: vscode.ExtensionContext,
  ) {
    this.statusBar = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.statusBar.command = "app-explorer.browseCards";
    context.subscriptions.push(this.statusBar);
    allCards.subscribe(this.renderStatusBar.bind(this));
  }

  renderStatusBar() {
    const { sockets, statusBar, allCards } = this;
    if (sockets.size == 0) {
      statusBar.backgroundColor = "red";
    }

    let cardsInEditor = [];
    const uri = vscode.window.activeTextEditor?.document.uri;
    if (uri) {
      const path = getRelativePath(uri);
      if (path) {
        cardsInEditor = [...allCards.listAllCards()].filter(
          (card) => card?.path === path,
        );
      }
    }

    const totalCards = allCards.totalCards();
    if (cardsInEditor.length > 0) {
      statusBar.text = `AppExplorer (${cardsInEditor.length}/${totalCards} cards)`;
    } else if (allCards.totalCards() > 0) {
      statusBar.text = `AppExplorer (${totalCards} cards)`;
    } else {
      statusBar.text = `AppExplorer (${sockets.size} sockets)`;
    }
    statusBar.show();
  }
}
