import * as vscode from "vscode";
import { makeExpressServer } from "./server";
import { CardData, RequestEvents, ResponseEvents } from "./EventTypes";
import { Socket } from "socket.io";
import { makeHoverProvider } from "./make-hover-provider";
import { makeNewCardHandler } from "./make-new-card-handler";
import { makeActiveTextEditorHandler } from "./make-active-text-editor-handler";
import { makeTextSelectionHandler } from "./make-text-selection-handler";
import { getRelativePath } from "./get-relative-path";

export type HandlerContext = {
  statusBar: vscode.StatusBarItem;
  sockets: Map<string, Socket>;
  lastPosition: vscode.Position | undefined;
  lastUri: vscode.Uri | undefined;
  waitForConnections: () => Promise<void>;
  emit: <T extends keyof RequestEvents>(
    event: T,
    ...data: Parameters<RequestEvents[T]>
  ) => void;
};

export function activate(context: vscode.ExtensionContext) {
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  // myStatusBarItem.command = myCommandId;
  context.subscriptions.push(statusBar);

  const cardDecoration = vscode.window.createTextEditorDecorationType({
    // gutterIconPath: path.join(__filename, "..", "images", "card.svg"),
    // gutterIconSize: "contain",
    overviewRulerColor: "blue",
    overviewRulerLane: vscode.OverviewRulerLane.Right,
    isWholeLine: true,
    light: {
      textDecoration: "underline wavy rgba(0, 255, 0, 0.9)",
    },
    dark: {
      textDecoration: "underline wavy rgba(0, 255, 0, 0.3)",
    },
  });

  const editorCards = makeHoverProvider(context);

  const cardsInEditor: ResponseEvents["cardsInEditor"] = ({ path, cards }) => {
    // console.log("on cardsInEditor", uri, cards);
    // Find the editor with this URI
    const editor = vscode.window.visibleTextEditors.find(
      (editor) => getRelativePath(editor.document.uri) === path
    );
    if (editor) {
      editorCards.set(editor, cards);
      const decorations: vscode.DecorationOptions[] = [];
      cards.forEach((card: CardData) => {
        decorations.push({
          range: new vscode.Range(
            card.symbolPosition.start.line,
            card.symbolPosition.start.character,
            card.symbolPosition.end.line,
            card.symbolPosition.end.character
          ),
          renderOptions: {},
        });
      });
      editor.setDecorations(cardDecoration, decorations);
    }
    vscode.window.showInformationMessage(
      `Found ${cards.length} cards in ${path}`
    );
  };

  const sockets = new Map<string, Socket>();

  const handlerContext: HandlerContext = {
    statusBar,
    lastPosition: undefined,
    lastUri: undefined,
    emit: (t, ...data) => io.emit(t, ...data),
    async waitForConnections() {
      if (sockets.size > 0) {
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "AppExplorer: Waiting for connections...",
          cancellable: true,
        },
        async (_progress, token) => {
          token.onCancellationRequested(() => {
            console.log("User canceled the long running operation");
          });

          while (sockets.size === 0) {
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
        }
      );
    },
    sockets,
  };
  const io = makeExpressServer(cardsInEditor, handlerContext);
  context.subscriptions.push(
    vscode.commands.registerCommand("app-explorer.connect", () => {
      // This command doesn't really need to do anything. By activating the
      // extension it will launch the webserver.
      //
      // This is useful for connecting the board for navigation purposes
      // instead of creating new cards.
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "app-explorer.createCard",
      makeNewCardHandler(handlerContext)
    )
  );

  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(
      makeTextSelectionHandler(handlerContext)
    )
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(
      makeActiveTextEditorHandler(handlerContext)
    )
  );
}

export function deactivate() {}

export function selectRangeInEditor(
  range: vscode.Range,
  editor: vscode.TextEditor
) {
  const newSelection = new vscode.Selection(range.start, range.end);
  editor.selection = newSelection;
  editor.revealRange(newSelection);
}

export async function getReferencesInFile(
  document: vscode.TextDocument
): Promise<vscode.Location[]> {
  const symbols = await vscode.commands.executeCommand<
    vscode.SymbolInformation[]
  >("vscode.executeDocumentSymbolProvider", document.uri);
  console.log("symbols", symbols);
  const references: vscode.Location[] = [];
  for (const symbol of symbols) {
    const locations = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeReferenceProvider",
      document.uri,
      symbol.location.range.start
    );
    for (const location of locations) {
      if (location.uri.toString() === document.uri.toString()) {
        references.push(location);
      }
    }
  }
  return references;
}
