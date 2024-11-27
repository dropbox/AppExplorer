import * as vscode from "vscode";
import { CardData } from "./EventTypes";
import { Socket } from "socket.io";
import { getRelativePath } from "./get-relative-path";

export class StatusBarManager {
  public statusBar: vscode.StatusBarItem;

  constructor(
    private sockets: Map<string, Socket>,
    private allCards: Map<CardData["miroLink"], CardData>,
    context: vscode.ExtensionContext,
  ) {
    this.statusBar = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.statusBar.command = "app-explorer.browseCards";
    context.subscriptions.push(this.statusBar);
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
        cardsInEditor = [...allCards.values()].filter(
          (card) => card?.path === path,
        );
      }
    }

    if (cardsInEditor.length > 0) {
      statusBar.text = `AppExplorer (${cardsInEditor.length}/${allCards.size} cards)`;
    } else if (allCards.size > 0) {
      statusBar.text = `AppExplorer (${allCards.size} cards)`;
    } else {
      statusBar.text = `AppExplorer (${sockets.size} sockets)`;
    }
    statusBar.show();
  }
}
