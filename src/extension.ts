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
        const document = editor.document;
        const position = editor.selection.active;

        // Fetch go to definition information
        const definitions = await vscode.commands.executeCommand<
          Array<vscode.LocationLink | vscode.Location>
        >("vscode.executeDefinitionProvider", document.uri, position);

        if (definitions && definitions.length > 0) {
          const def = definitions[0];

          if ("targetUri" in def && "targetSelectionRange" in def) {
            const symbolRange = def.targetSelectionRange!;
            const defaultTitle = await readTargetSelectionRange(def);
            const title = await vscode.window.showInputBox({
              prompt: "Enter card title",
              value: defaultTitle,
            });
            if (!title) {
              return;
            }

            const path = getRelativePath(def.targetUri)!;

            io.emit("newCard", {
              title,
              path: path,
              codeLink: await getGitHubUrl(def),
              symbolPosition: {
                start: {
                  line: symbolRange.start.line,
                  character: symbolRange.start.character,
                },
                end: {
                  line: symbolRange.end.line,
                  character: symbolRange.end.character,
                },
              },
              definitionPosition: {
                start: {
                  line: def.targetRange.start.line,
                  character: def.targetRange.start.character,
                },
                end: {
                  line: def.targetRange.end.line,
                  character: def.targetRange.end.character,
                },
              },
            });
          }
        } else {
          vscode.window.showInformationMessage(
            "No definition information available."
          );
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
      async (progress, token) => {
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

async function readTargetSelectionRange(
  locationLink: vscode.LocationLink
): Promise<string | undefined> {
  const document = await vscode.workspace.openTextDocument(
    locationLink.targetUri
  );

  return document.getText(
    locationLink.targetSelectionRange ??
      locationLink.targetSelectionRange ??
      locationLink.targetRange
  );
}
