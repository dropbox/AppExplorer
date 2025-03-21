import { atom, getDefaultStore } from "jotai/vanilla";
import * as vscode from "vscode";
import { allCardsAtom, CardStorage, numConnectionsAtom } from "./card-storage";
import { CardData } from "./EventTypes";

const store = getDefaultStore();

type StatusbarData = {
  numBoards: number;
  allCards: CardData[];
};

export class StatusBarManager {
  public statusBar: vscode.StatusBarItem;
  private unsubscribe: () => void;

  dataAtom = atom((get): StatusbarData => {
    const numBoards = get(numConnectionsAtom);
    const allCards = get(allCardsAtom);
    return {
      numBoards,
      allCards,
    };
  });

  constructor(private cardStorage: CardStorage) {
    this.statusBar = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.statusBar.command = "app-explorer.browseCards";

    this.unsubscribe = store.sub(this.dataAtom, () => {
      this.renderStatusBar(store.get(this.dataAtom));
    });
  }

  dispose() {
    this.statusBar.dispose();
    this.unsubscribe();
  }

  renderStatusBar({ numBoards, allCards }: StatusbarData) {
    if (numBoards > 0) {
      const disconnected = allCards.filter(
        (card) => card.status === "disconnected",
      ).length;

      this.statusBar.text = `$(app-explorer) (${allCards.length} $(preview) ${numBoards} $(window)${
        disconnected > 0 ? `, ${disconnected} $(debug-disconnect)` : ""
      })`;
    } else {
      this.statusBar.text = `$(app-explorer)  (${numBoards} Miro connections)`;
    }
    this.statusBar.show();
  }
}
