import * as vscode from "vscode";
import { CardData } from "./EventTypes";
import { HandlerContext } from "./extension";
import { getRelativePath } from "./get-relative-path";
import { LocationFinder } from "./location-finder";
import { createLogger } from "./logger";
import { listenToAllEvents } from "./test/helpers/listen-to-all-events";
import { WorkspaceCardStorage } from "./workspace-card-storage";

const logger = createLogger("decorator");

interface CardDecoration extends vscode.DecorationOptions {
  card: CardData;
  selected: boolean;
}

export class EditorDecorator {
  #decorator: vscode.TextEditorDecorationType;
  #selectedDecorator: vscode.TextEditorDecorationType;
  #activeEdtior: vscode.TextEditor | undefined;
  timeout: NodeJS.Timeout | undefined;
  #cardStorage: WorkspaceCardStorage | undefined;
  #eventListeners:
    | {
        boardUpdate: () => void;
        cardUpdate: () => void;
        connectedBoards: () => void;
        selectedCards: () => void;
        workspaceBoards: () => void;
      }
    | undefined;
  subscriptions: vscode.Disposable[] = [];
  selectedIds: string[] = [];

  constructor(private handlerContext: HandlerContext) {
    this.#decorator = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor("appExplorer.backgroundHighlight"),
      overviewRulerColor: new vscode.ThemeColor("appExplorer.rulerColor"),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });
    this.#selectedDecorator = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor("appExplorer.selectedBackground"),
      overviewRulerColor: new vscode.ThemeColor("appExplorer.rulerColor"),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });
    this.#activeEdtior = vscode.window.activeTextEditor;

    let lastPosition: vscode.Position | undefined;
    let lastEditor: vscode.TextEditor | undefined;

    this.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(
        (editor) => {
          if (this.#activeEdtior && !editor) {
            lastPosition = this.#activeEdtior.selection.active;
            lastEditor = this.#activeEdtior;
            setTimeout(() => {
              lastPosition = undefined;
              lastEditor = undefined;
            }, 500);
          }

          this.#activeEdtior = editor;
          if (this.#activeEdtior) {
            this.triggerUpdate();
          }
        },
        null,
        this.subscriptions,
      ),
    );
    this.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument(
        (event) => {
          if (
            this.#activeEdtior &&
            event.document === this.#activeEdtior.document
          ) {
            this.triggerUpdate(true);
          }
        },
        null,
        this.subscriptions,
      ),
    );

    if (this.#activeEdtior) {
      this.triggerUpdate();
    }

    // Store CardStorage reference for cleanup
    this.#cardStorage = handlerContext.cardStorage;

    // Listen to all storage events that might affect card display
    this.subscriptions.push({
      dispose: listenToAllEvents(this.#cardStorage, () => {
        this.triggerUpdate(true);
      }),
    });
  }

  dispose() {
    // Remove event listeners to prevent memory leaks
    if (this.#cardStorage && this.#eventListeners) {
      this.#cardStorage.off("boardUpdate", this.#eventListeners.boardUpdate);
      this.#cardStorage.off("cardUpdate", this.#eventListeners.cardUpdate);
      this.#cardStorage.off(
        "selectedCards",
        this.#eventListeners.selectedCards,
      );
      this.#cardStorage.off(
        "connectedBoards",
        this.#eventListeners.connectedBoards,
      );
      this.#cardStorage.off(
        "workspaceBoards",
        this.#eventListeners.workspaceBoards,
      );
    }

    // Clear references
    this.#cardStorage = undefined;
    this.#eventListeners = undefined;

    // Dispose of other resources
    this.#decorator.dispose();
    this.subscriptions.forEach((s) => s.dispose());
  }

  triggerUpdate(throttle = false) {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = undefined;
    }

    if (throttle) {
      // at 500, this seemed to get stuck in a loop
      this.timeout = setTimeout(this.decorateEditor, 1000);
    } else {
      // Only decorate files, not output panels
      if (
        this.#activeEdtior &&
        this.#activeEdtior.document.uri.scheme !== "file"
      ) {
        return;
      }

      this.selectedIds = this.#cardStorage?.getSelectedCardIDs() ?? [];
      logger.debug("Selected cards", this.selectedIds.length);
      this.decorateEditor();
    }
  }

  getCardsInEditor(editor: vscode.TextEditor) {
    const path = getRelativePath(editor.document.uri);
    return [...this.handlerContext.cardStorage.listAllCards()].filter(
      (card) => card.path === path,
    );
  }

  decorateEditor = async () => {
    const editor = this.#activeEdtior;
    if (!editor) {
      return;
    }
    const document = editor.document;
    const cards = this.getCardsInEditor(editor);
    const locationFinder = new LocationFinder();
    const symbols = await locationFinder.findSymbolsInDocument(document.uri);

    const ranges = cards.flatMap((card): CardDecoration[] => {
      if (card?.type === "symbol") {
        const symbol = symbols.find((symbol) => symbol.label === card.symbol);
        if (symbol?.range) {
          return [
            {
              range: symbol.range,
              hoverMessage: `AppExplorer: ${card.title}`,
              card,
              selected: this.selectedIds.includes(card.miroLink!),
            },
          ];
        }
      }
      return [];
    });

    const notSelected = ranges.filter((r) => !r.selected);
    editor.setDecorations(this.#decorator, notSelected);
    const selected = ranges.filter((r) => r.selected);
    editor.setDecorations(this.#selectedDecorator, selected);

    logger.debug(
      `Decorated editor with ${ranges.length} cards. (${selected.length} selected) ${document.uri}`,
    );
  };
}
