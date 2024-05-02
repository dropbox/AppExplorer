import * as vscode from "vscode";
import { makeExpressServer } from "./server";
import { CardData, RequestEvents } from "./EventTypes";
import { Socket } from "socket.io";
import { makeHoverProvider } from "./make-hover-provider";
import { makeNewCardHandler } from "./make-new-card-handler";
import { makeActiveTextEditorHandler } from "./make-active-text-editor-handler";
import { makeTextSelectionHandler } from "./make-text-selection-handler";
import { makeBrowseHandler } from "./make-browse-handler";

export type HandlerContext = {
  statusBar: vscode.StatusBarItem;
  sockets: Map<string, Socket>;
  allCards: Map<CardData["miroLink"], CardData>
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


  const editorCards = makeHoverProvider(context);

  const sockets = new Map<string, Socket>();
  const allCards = new Map<CardData["miroLink"], CardData>();

  const handlerContext: HandlerContext = {
    allCards,
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
  const io = makeExpressServer(handlerContext);
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
      "app-explorer.browseCards",
      makeBrowseHandler(handlerContext)
    )
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
      makeActiveTextEditorHandler(handlerContext, editorCards)
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
