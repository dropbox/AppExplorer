import * as vscode from "vscode";
import * as path from "path";
import { makeExpressServer } from "./server";
import { CardData, ResponseEvents } from "./EventTypes";
import * as util from "util";
import { Socket } from "socket.io";
import * as child_process from "child_process";

let statusBar: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
  statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  // myStatusBarItem.command = myCommandId;
  context.subscriptions.push(statusBar);

  context.subscriptions.push(
    vscode.commands.registerCommand("app-explorer.createCard", async () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        const uri = getRelativePath(editor.document.uri);
        if (!uri) {
          return;
        }
        await waitForConnections();

        const cardData = await makeCardData(editor);

        if (cardData) {
          const title = await vscode.window.showInputBox({
            prompt: "Card title",
            value: cardData.title.trim(),
          });
          if (title) {
            cardData.title = title;
            io.emit("newCard", cardData);
          }
        }
      }
    })
  );

  const cardDecoration = vscode.window.createTextEditorDecorationType({
    // gutterIconPath: path.join(__filename, "..", "images", "card.svg"),
    // gutterIconSize: "contain",
    overviewRulerColor: "blue",
    overviewRulerLane: vscode.OverviewRulerLane.Right,
    isWholeLine: false,
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
  const io = makeExpressServer(cardsInEditor, sockets, statusBar);

  async function waitForConnections() {
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
  }

  let lastPosition: vscode.Position | undefined;
  let lastUri: vscode.Uri | undefined;

  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection((event) => {
      const editor = event.textEditor;
      if (editor) {
        const position = editor.selection.active;
        const uri = editor.document.uri;
        if (lastPosition && lastUri && uri.fsPath !== lastUri.fsPath) {
          io.emit("jump", {
            lastUri: lastUri.toString(),
            lastPosition: lastPosition,
            uri: uri.toString(),
            position: position,
          });
        }
        lastPosition = position;
        lastUri = uri;
      }
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        const uri = editor.document.uri;
        const path = getRelativePath(uri);
        if (path) {
          io.emit("activeEditor", path);
        }

        lastUri = uri;
      }
    })
  );
}

function makeHoverProvider(context: vscode.ExtensionContext) {
  const m = new WeakMap<vscode.TextEditor, CardData[]>();
  const hoverProvider = vscode.languages.registerHoverProvider(
    { scheme: "file" },
    {
      provideHover(document, position) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          return;
        }

        const cards = m.get(editor);
        if (!cards) {
          return;
        }

        const range = document.getWordRangeAtPosition(position);
        if (!range) {
          return;
        }

        const word = document.getText(range);
        const card = cards.find((card) => card.title === word);
        if (!card) {
          return;
        }

        const contents = new vscode.MarkdownString();
        contents.appendMarkdown(`Miro: [${card.title}](${card.miroLink})\n`);

        return new vscode.Hover(contents, range);
      },
    }
  );

  context.subscriptions.push(hoverProvider);
  return m;
}

export function deactivate() {}

export function getRelativePath(uri: vscode.Uri): string | undefined {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders) {
    for (const folder of workspaceFolders) {
      if (uri.fsPath.startsWith(folder.uri.fsPath)) {
        return path.relative(folder.uri.fsPath, uri.fsPath);
      }
    }
  }
  return undefined;
}

const exec = util.promisify(child_process.exec);

async function getGitHubUrl(
  locationLink: vscode.LocationLink
): Promise<string | null> {
  const document = await vscode.workspace.openTextDocument(
    locationLink.targetUri
  );
  const uri = document.uri;
  const filePath = uri.fsPath;
  const relativeFilePath = getRelativePath(uri);

  // Get the current git hash
  const gitHash = await exec("git rev-parse HEAD", {
    cwd: path.dirname(filePath),
  })
    .then(({ stdout }) => stdout.trim())
    .catch(() => null);

  if (!gitHash) {
    return null;
  }

  // Get the remote URL for the current repository
  const gitRemoteUrl = await exec("git config --get remote.origin.url", {
    cwd: path.dirname(filePath),
  })
    .then(({ stdout }) => stdout.trim())
    .catch(() => null);

  if (!gitRemoteUrl) {
    return null;
  }

  // Parse the remote URL to get the repository owner and name
  const gitRemoteUrlParts = gitRemoteUrl.match(
    /github\.com[:/](.*)\/(.*)\.git/
  );
  if (!gitRemoteUrlParts) {
    return null;
  }
  const gitRepoOwner = gitRemoteUrlParts[1];
  const gitRepoName = gitRemoteUrlParts[2];

  const lineNumber =
    locationLink.targetSelectionRange?.start.line ??
    locationLink.targetRange.start.line;

  // Construct the GitHub URL for the current file and line number
  const gitHubUrl = `https://github.com/${gitRepoOwner}/${gitRepoName}/blob/${gitHash}/${relativeFilePath}#L${lineNumber}`;

  return gitHubUrl;
}

async function getAllSymbols(
  document: vscode.TextDocument
): Promise<vscode.SymbolInformation[]> {
  const symbols = await vscode.commands.executeCommand<
    vscode.SymbolInformation[]
  >("vscode.executeDocumentSymbolProvider", document.uri);
  return symbols || [];
}

async function makeCardData(
  editor: vscode.TextEditor
): Promise<CardData | null> {
  const document = editor.document;
  const position = editor.selection.active;

  const symbols = await getAllSymbols(document);
  console.log(symbols);

  let symbol = symbols.find((symbol) => {
    return symbol.location.range.start.line === position.line;
  });

  if (!symbol) {
    const selection = await showSymbolPicker(document, position);
    if (selection === cancel) {
      return null;
    }
    symbol = selection;
  }

  if (symbol) {
    const newSelection = new vscode.Selection(
      symbol.location.range.start,
      symbol.location.range.end
    );
    editor.selection = newSelection;
    editor.revealRange(newSelection);
  }

  const lineAt = document.lineAt(position);
  let def: vscode.LocationLink = {
    targetUri: document.uri,
    targetRange: lineAt.range,
    targetSelectionRange: lineAt.range,
  };

  if (symbol) {
    def = {
      targetUri: symbol.location.uri,
      targetRange: symbol.location.range,
      targetSelectionRange: symbol.location.range,
    };
  }

  const title = await vscode.window.showInputBox({
    prompt: "Card title" + (symbol ? ` (${symbol.name})` : ""),
    value: symbol?.name ?? document.getText(lineAt.range),
  });
  if (!title) {
    return null;
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
