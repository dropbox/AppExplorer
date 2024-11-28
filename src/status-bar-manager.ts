import * as vscode from "vscode";
import { Socket } from "socket.io";
import { CardStorage } from "./card-storage";

export class StatusBarManager {
  public statusBar: vscode.StatusBarItem;

  constructor(
    private sockets: Map<string, Socket>,
    private cardStorage: CardStorage,
    context: vscode.ExtensionContext,
  ) {
    this.statusBar = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.statusBar.command = "app-explorer.browseCards";
    context.subscriptions.push(this.statusBar);
    cardStorage.subscribe(() => this.renderStatusBar());
  }

  renderStatusBar() {
    const { sockets, statusBar, cardStorage } = this;
    if (sockets.size == 0) {
      statusBar.backgroundColor = "red";
    }
    const totalCards = cardStorage.totalCards();
    const boardIds = cardStorage.listBoardIds();
    if (sockets.size > 0) {
      statusBar.text = `AppExplorer (${totalCards} cards across ${boardIds.length} boards)`;
    } else {
      statusBar.text = `AppExplorer (${sockets.size} Miro connections)`;
    }
    statusBar.show();
  }
}
