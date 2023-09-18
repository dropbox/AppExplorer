import * as vscode from "vscode";
import * as path from "path";
import { makeExpressServer } from "./server";
import { CardData, ResponseEvents } from "./EventTypes";

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("app-explorer.createCard", async () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        const uri = getRelativePath(editor.document.uri);
        if (!uri) {
          return;
        }
        const document = editor.document;
        const position = editor.selection.active;

        // Fetch hover information
        // const hover = await vscode.commands.executeCommand<vscode.Hover[]>(
        //   "vscode.executeHoverProvider",
        //   document.uri,
        //   position
        // );
        // if (hover && hover.length > 0) {
        //   const contents = hover[0].contents;

        //   console.log({ contents });
        //   vscode.window.showInformationMessage(
        //     `Symbol Info: ${contents.map((c) => c.value).join(" ")}`
        //   );
        // } else {
        //   vscode.window.showInformationMessage(
        //     "No symbol information available."
        //   );
        // }

        // Fetch go to definition information
        const definitions = await vscode.commands.executeCommand<
          Array<vscode.LocationLink | vscode.Location>
        >("vscode.executeDefinitionProvider", document.uri, position);

        if (definitions && definitions.length > 0) {
          const def = definitions[0];
          console.log({ def });

          if ("targetUri" in def && "targetSelectionRange" in def) {
            const symbolRange = def.targetSelectionRange!;
            const title = editor.document.getText(symbolRange);

            const path = getRelativePath(def.targetUri)!;

            console.log({ path });
            io.emit("newCard", {
              title,
              path: path,
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
    isWholeLine: true,
    light: {
      textDecoration: "underline wavy rgba(0, 255, 0, 0.1)",
    },
    dark: {
      textDecoration: "underline wavy rgba(0, 255, 0, 0.3)",
    },
  });

  const cardsInEditor: ResponseEvents["cardsInEditor"] = ({ path, cards }) => {
    // console.log("on cardsInEditor", uri, cards);
    // Find the editor with this URI
    const editor = vscode.window.visibleTextEditors.find(
      (editor) => getRelativePath(editor.document.uri) === path
    );
    console.log("editor", editor, cards);
    if (editor) {
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
        //   editor.setDecorations(cardDecoration, [
        //     new vscode.Range(
        //       card.startLine,
        //       0,
        //       card.endLine,
        //       Number.MAX_SAFE_INTEGER
        //     ),
        //   ]);
      });
      editor.setDecorations(cardDecoration, decorations);
    }
    vscode.window.showInformationMessage(
      `Found ${cards.length} cards in ${path}`
    );
  };

  const io = makeExpressServer(cardsInEditor);

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

export function deactivate() {}

function getRelativePath(uri: vscode.Uri): string | undefined {
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
