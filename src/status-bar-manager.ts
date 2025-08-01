import createDebug from "debug";
import * as vscode from "vscode";
import { WorkspaceCardStorage } from "./workspace-card-storage";

const debug = createDebug("app-explorer:status-bar-manager");

export class StatusBarManager {
  public statusBar: vscode.StatusBarItem;
  private eventListeners: {
    boardUpdate: () => void;
    cardUpdate: () => void;
    connectedBoards: () => void;
    workspaceBoards: () => void;
  };

  constructor(private cardStorage: WorkspaceCardStorage) {
    this.statusBar = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.statusBar.command = "app-explorer.browseCards";

    // Create event listener functions that can be removed later
    this.eventListeners = {
      boardUpdate: () => this.renderStatusBar(),
      cardUpdate: () => this.renderStatusBar(),
      connectedBoards: () => this.renderStatusBar(),
      workspaceBoards: () => this.renderStatusBar(),
    };

    // Add event listeners
    cardStorage.on("boardUpdate", this.eventListeners.boardUpdate);
    cardStorage.on("cardUpdate", this.eventListeners.cardUpdate);
    cardStorage.on("connectedBoards", this.eventListeners.connectedBoards);
    cardStorage.on("workspaceBoards", this.eventListeners.workspaceBoards);
  }

  dispose() {
    // Remove event listeners to prevent memory leaks
    this.cardStorage.off("boardUpdate", this.eventListeners.boardUpdate);
    this.cardStorage.off("cardUpdate", this.eventListeners.cardUpdate);
    this.cardStorage.off(
      "connectedBoards",
      this.eventListeners.connectedBoards,
    );
    this.cardStorage.off(
      "workspaceBoards",
      this.eventListeners.workspaceBoards,
    );

    // Dispose of status bar
    this.statusBar.dispose();
  }

  renderStatusBar() {
    const connectedBoards = this.cardStorage.getConnectedBoards();
    if (connectedBoards.length === 0) {
      this.statusBar.text = "$(app-explorer) (No Miro connections)";
      this.statusBar.show();
      return;
    }
    const boardIds = this.cardStorage.listBoardIds();
    const allCards = this.cardStorage.listAllCards();
    const totalCards = allCards.length;
    if (connectedBoards.length > 0) {
      const disconnected = allCards.filter(
        (card) => card.status === "disconnected",
      ).length;

      this.statusBar.text = `$(app-explorer) (${totalCards} $(preview) ${boardIds.length} $(window)${
        disconnected > 0 ? `, ${disconnected} $(debug-disconnect)` : ""
      })`;
    } else {
      this.statusBar.text = `$(app-explorer)  (${connectedBoards.length} Miro connections)`;
    }
    this.statusBar.show();
  }
}
