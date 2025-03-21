import * as fs from "fs";
import { atom, getDefaultStore } from "jotai/vanilla";
import * as path from "path";
import * as vscode from "vscode";
import { AppExplorerLens } from "./app-explorer-lens";
import {
  activeBoardsConnectionsAtom,
  cardNavigationAtom,
  CardStorage,
  contextAtom,
  numConnectionsAtom,
  storageAtom,
} from "./card-storage";
import { makeAttachCardHandler } from "./commands/attach-card";
import { goToCardCode, makeBrowseHandler } from "./commands/browse";
import { makeNewCardHandler } from "./commands/create-card";
import { makeWorkspaceBoardHandler } from "./commands/manage-workspace-boards";
import { makeNavigationHandler } from "./commands/navigate";
import { makeRenameHandler } from "./commands/rename-board";
import { makeTagCardHandler } from "./commands/tag-card";
import { registerUpdateCommand } from "./commands/update-extension";
import { registerUpdateCommand } from "./commands/update-extension";
import { EditorDecorator } from "./editor-decorator";
import type { CardData } from "./EventTypes";
import { getGitHubUrl } from "./get-github-url";
import { LocationFinder } from "./location-finder";
import { MiroServer } from "./server";
import { StatusBarManager } from "./status-bar-manager";
import { LocationFinder } from "./location-finder";
import path = require("node:path");
import fs = require("node:fs");

const store = getDefaultStore();

export type HandlerContext = {
  cardStorage: CardStorage;
  waitForConnections: () => Promise<void>;
};

export async function activate(context: vscode.ExtensionContext) {
  registerUpdateCommand(context);
  setUpdateCommandContext(context);
  vscode.workspace.onDidChangeWorkspaceFolders(() => {
    setUpdateCommandContext(context);
  });

  vscode.commands.executeCommand("setContext", "appExplorer.enabled", true);
  store.set(contextAtom, context);

  const locationFinder = new LocationFinder();
  const cardStorage = new CardStorage(context);
  const statusBarManager = new StatusBarManager(cardStorage);
  context.subscriptions.push(statusBarManager);

  const handlerContext: HandlerContext = {
    cardStorage,
    async waitForConnections() {
      if (store.get(numConnectionsAtom) > 0) {
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
          await new Promise<void>((resolve) => {
            const unsubscribe = store.sub(numConnectionsAtom, () => {
              if (store.get(numConnectionsAtom) > 0) {
                resolve();
                unsubscribe();
              }
            });
          });
        },
      );
    },
  };

  const navigateToCard = async (card: CardData, preview = false) => {
    const dest = await locationFinder.findCardDestination(card);

    // Only connect if it's able to reach the symbol
    const status = (await goToCardCode(card, preview))
      ? "connected"
      : "disconnected";
    if (card.miroLink) {
      let codeLink: string | null = null;
      if (dest) {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
          const uri = activeEditor.document.uri;
          const selection =
            status === "connected"
              ? new vscode.Range(
                  activeEditor.selection.start,
                  activeEditor.selection.end,
                )
              : new vscode.Range(
                  new vscode.Position(0, 0),
                  new vscode.Position(0, 0),
                );

          const def: vscode.LocationLink = {
            targetUri: uri,
            targetRange: selection,
          };
          codeLink = await getGitHubUrl(def);
        }
      }
      if (status !== card.status) {
        cardStorage.setCard(card.boardId, {
          ...card,
          status,
          miroLink: codeLink ?? undefined,
        });
      }
      miroServer.query(card.boardId, "cardStatus", {
        miroLink: card.miroLink,
        status,
        codeLink,
      });
    }
    return status === "connected";
  };

  const miroServer = new MiroServer();
  context.subscriptions.push(miroServer);

  const navigationSub = store.sub(cardNavigationAtom, () => {
    const card = store.get(cardNavigationAtom);
    if (card) {
      navigateToCard(card);
      store.set(cardNavigationAtom, null);
    }
  });

  const connectionsAnnounced = atom([] as string[]);
  const newBoardConnectionsAtom = atom((get) => {
    const connected = get(activeBoardsConnectionsAtom);
    const announced = get(connectionsAnnounced);
    const newConnections = connected.filter(
      (boardId) => !announced.includes(boardId),
    );

    const newBoardConnections = newConnections.flatMap((boardId) => {
      const boardAtom = get(storageAtom).find((b) => get(b).id === boardId);
      if (boardAtom) {
        const boardInfo = get(boardAtom);
        return boardInfo;
      }
      return [];
    });

    return { newBoardConnections };
  });

  const newConnectionUnsub = store.sub(
    activeBoardsConnectionsAtom,
    async () => {
      const { newBoardConnections } = store.get(newBoardConnectionsAtom);

      if (newBoardConnections.length > 0) {
        await Promise.all(
          newBoardConnections.map(async (boardInfo) => {
            const selection = await vscode.window.showInformationMessage(
              `AppExplorer - Connected to board: ${boardInfo?.name ?? boardInfo.id}`,
              "Rename Board",
            );
            if (selection === "Rename Board") {
              vscode.commands.executeCommand(
                "app-explorer.renameBoard",
                boardInfo.id,
              );
            }
          }),
        );
      }
    },
  );

  context.subscriptions.push({
    dispose() {
      navigationSub();
      newConnectionUnsub();
    },
  });
  context.subscriptions.push(
    vscode.commands.registerCommand("app-explorer.connect", () => {
      // This command doesn't really need to do anything. By activating the
      // extension it will launch the webserver.
      //
      // This is useful for connecting the board for navigation purposes
      // instead of creating new cards.
    }),
    new EditorDecorator(handlerContext),
    vscode.languages.registerCodeLensProvider(
      { scheme: "file" },
      new AppExplorerLens(handlerContext),
    ),
    vscode.commands.registerCommand(
      "app-explorer.navigate",
      makeNavigationHandler(handlerContext, miroServer),
    ),
    vscode.commands.registerCommand(
      "app-explorer.browseCards",
      makeBrowseHandler(handlerContext, navigateToCard, miroServer),
    ),
    vscode.commands.registerCommand(
      "app-explorer.createCard",
      makeNewCardHandler(handlerContext, miroServer),
    ),
    vscode.commands.registerCommand(
      "app-explorer.attachCard",
      makeAttachCardHandler(handlerContext, miroServer),
    ),
    vscode.commands.registerCommand(
      "app-explorer.tagCard",
      makeTagCardHandler(handlerContext, miroServer),
    ),
    vscode.commands.registerCommand(
      "app-explorer.renameBoard",
      makeRenameHandler(handlerContext, miroServer),
    ),
    vscode.commands.registerCommand(
      "app-explorer.manageWorkspaceBoards",
      makeWorkspaceBoardHandler(handlerContext),
    ),
  );

  return {
    // IDK what to use this for, I just want to verify it works.
    appExplorer: true,
  };
}

function setUpdateCommandContext(context: vscode.ExtensionContext) {
  let updateWorkspacePath: string | undefined = undefined;
  if (vscode.workspace.workspaceFolders) {
    for (const folder of vscode.workspace.workspaceFolders) {
      const packageJsonPath = path.join(folder.uri.fsPath, "package.json");
      if (fs.existsSync(packageJsonPath)) {
        try {
          const packageJson = JSON.parse(
            fs.readFileSync(packageJsonPath, "utf8"),
          );
          if (packageJson.name === "app-explorer") {
            updateWorkspacePath = folder.uri.fsPath;
            break;
          }
        } catch (error) {
          console.error("Error parsing package.json:", error);
        }
      }
    }
  }
  vscode.commands.executeCommand(
    "setContext",
    "app-explorer.enableUpdate",
    !!updateWorkspacePath,
  );
  context.workspaceState.update("updateWorkspacePath", updateWorkspacePath);
}

export function deactivate() {
  vscode.commands.executeCommand("setContext", "appExplorer.enabled", false);
  vscode.commands.executeCommand(
    "setContext",
    "app-explorer.enableUpdate",
    false,
  );
}

export function selectRangeInEditor(
  range: vscode.Range,
  editor: vscode.TextEditor,
) {
  const newSelection = new vscode.Selection(range.start, range.end);
  editor.selection = newSelection;
  editor.revealRange(newSelection);
}
