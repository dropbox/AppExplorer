import createDebug from "debug";
import * as vscode from "vscode";
import { CardData } from "./EventTypes";
import { HandlerContext } from "./extension";
import { getRelativePath } from "./get-relative-path";
import { LocationFinder } from "./location-finder";
import { listenToAllEvents } from "./test/helpers/listen-to-all-events";
import { WorkspaceCardStorage } from "./workspace-card-storage";

const debug = createDebug("app-explorer:editor-decorator");

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
  subscriptions: vscode.Disposable[] = [];

  constructor(private handlerContext: HandlerContext) {
    this.#decorator = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor("appExplorer.background"),
      overviewRulerColor: new vscode.ThemeColor("appExplorer.rulerColor"),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });
    this.#selectedDecorator = vscode.window.createTextEditorDecorationType({
      border: "1px solid",
      backgroundColor: new vscode.ThemeColor("appExplorer.selectedBackground"),
      borderColor: new vscode.ThemeColor("appExplorer.selectedBorder"),
      overviewRulerColor: new vscode.ThemeColor("appExplorer.rulerColor"),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });
    this.subscriptions.push(this.#decorator, this.#selectedDecorator);
    this.#activeEdtior = vscode.window.activeTextEditor;

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
      dispose: listenToAllEvents(this.#cardStorage, (eventName) => {
        debug(`Card storage event: ${eventName}`);
        this.triggerUpdate(true);
      }),
    });
  }

  dispose() {
    this.#cardStorage = undefined;
    this.subscriptions.forEach((s) => s.dispose());
  }

  triggerUpdate(throttle = false) {
    debug("triggerUpdate", !!this.timeout, throttle);
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
    debug("Decorating editor", !!editor);
    if (!editor) {
      return;
    }
    const selectedIds = this.#cardStorage?.getSelectedCardIDs() ?? [];
    debug("Selected cards", selectedIds);
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
              selected: selectedIds.includes(card.miroLink!),
            },
          ];
        }
      }
      return [];
    });

    editor.setDecorations(this.#decorator, ranges);
    const selected = ranges.filter((r) => r.selected);
    editor.setDecorations(this.#selectedDecorator, selected);

    debug(
      `Decorated editor with ${ranges.length} cards. (${selected.length} selected) ${document.uri} (${selectedIds.join(", ")})`,
    );
  };
}
