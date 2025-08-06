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

  #cardStorage: WorkspaceCardStorage;
  constructor(cardStorage: WorkspaceCardStorage) {
    this.#cardStorage = cardStorage;
    this.statusBar = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.statusBar.command = "app-explorer.browseCards";
    debug("Setup status bar");

    // Create event listener functions that can be removed later
    this.eventListeners = {
      boardUpdate: () => this.renderStatusBar(),
      cardUpdate: () => this.renderStatusBar(),
      connectedBoards: () => this.renderStatusBar(),
      workspaceBoards: () => this.renderStatusBar(),
    };

    // Add event listeners
    this.#cardStorage.on("boardUpdate", this.eventListeners.boardUpdate);
    this.#cardStorage.on("cardUpdate", this.eventListeners.cardUpdate);
    this.#cardStorage.on(
      "connectedBoards",
      this.eventListeners.connectedBoards,
    );
    this.#cardStorage.on(
      "workspaceBoards",
      this.eventListeners.workspaceBoards,
    );
  }

  dispose() {
    // Remove event listeners to prevent memory leaks
    this.#cardStorage.off("boardUpdate", this.eventListeners.boardUpdate);
    this.#cardStorage.off("cardUpdate", this.eventListeners.cardUpdate);
    this.#cardStorage.off(
      "connectedBoards",
      this.eventListeners.connectedBoards,
    );
    this.#cardStorage.off(
      "workspaceBoards",
      this.eventListeners.workspaceBoards,
    );

    // Dispose of status bar
    this.statusBar.dispose();
  }

  renderStatusBar() {
    const connectedBoards = this.#cardStorage.getConnectedBoards();
    if (connectedBoards.length === 0) {
      this.statusBar.text = "$(app-explorer) (No Miro connections)";
      return;
    } else {
      const boardIds = this.#cardStorage.listBoardIds();
      const allCards = this.#cardStorage.listAllCards();
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
    }

    debug(this.statusBar.text);
    this.statusBar.show();
  }
}
