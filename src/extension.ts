import * as vscode from "vscode";
import { makeExpressServer } from "./server";
import { CardData, RequestEvents, ResponseEvents } from "./EventTypes";
import { Socket } from "socket.io";
import { makeHoverProvider } from "./make-hover-provider";
import { makeNewCardHandler } from "./make-new-card-handler";
import { makeActiveTextEditorHandler } from "./make-active-text-editor-handler";
import { makeTextSelectionHandler } from "./make-text-selection-handler";
import { getGitHubUrl } from "./get-github-url";
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

export async function makeCardData(
  editor: vscode.TextEditor
): Promise<CardData | null> {
  const document = editor.document;
  const position = editor.selection.active;

  await getAllReferencesInFile();

  const symbol = await showSymbolPicker(document, position);
  if (symbol === cancel) {
    return null;
  }

  if (symbol) {
    selectSymbolInEditor(symbol, editor);
  }
  const lineAt = document.lineAt(position);
  const title = await vscode.window.showInputBox({
    prompt: "Card title" + (symbol ? ` (${symbol.name})` : ""),
    value: symbol?.name ?? document.getText(lineAt.range),
  });
  if (!title) {
    return null;
  }

  let def: vscode.LocationLink = {
    targetUri: document.uri,
    targetRange: lineAt.range,
  };
  if (symbol) {
    def = {
      targetUri: symbol.location.uri,
      targetRange: symbol.location.range,
    };
  }

  const path = getRelativePath(def.targetUri)!;

  return {
    title,
    path,
    symbol: symbol?.name,
    codeLink: await getGitHubUrl(def),
    symbolPosition: def.targetRange,
  };
}

const cancel = Symbol("cancel");

function selectSymbolInEditor(
  symbol: vscode.SymbolInformation,
  editor: vscode.TextEditor
) {
  const newSelection = new vscode.Selection(
    symbol.location.range.start,
    symbol.location.range.end
  );
  editor.selection = newSelection;
  editor.revealRange(newSelection);
}

async function showSymbolPicker(
  document: vscode.TextDocument,
  position: vscode.Position
): Promise<vscode.SymbolInformation | undefined | typeof cancel> {
  const symbols = await vscode.commands.executeCommand<
    vscode.SymbolInformation[]
  >("vscode.executeDocumentSymbolProvider", document.uri);
  const symbol = symbols.find((symbol) => {
    // If you trigger the command while on the start line for a symbol, that's
    // probably what you're trying to create a card for
    return symbol.location.range.start.line === position.line;
  });
  if (symbol) {
    return symbol;
  }

  const sortedSymbols = [...symbols].sort((a, b) => {
    if (a.location.range.contains(position)) {
      return -1;
    }
    if (b.location.range.contains(position)) {
      return 1;
    }
    return 0;
  });

  const symbolNames = sortedSymbols.map((symbol) => {
    return symbol.name;
  });
  const none = "(None)";
  const selectedSymbolName = await vscode.window.showQuickPick(
    [none, ...symbolNames],
    {
      placeHolder: `Choose a symbol to anchor the card to`,
    }
  );
  if (!selectedSymbolName) {
    return cancel;
  }
  if (selectedSymbolName === none) {
    return;
  }
  const selectedSymbol = symbols.find((symbol) => {
    return symbol.name === selectedSymbolName;
  });
  return selectedSymbol;
}

async function getReferencesInFile(
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

async function getAllReferencesInFile() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const document = editor.document;

  const references = await getReferencesInFile(document);
  console.log(
    "references",
    references.map(
      (ref) => ref.range.start.line + ": " + editor.document.getText(ref.range)
    )
  );
}
