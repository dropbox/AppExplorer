import * as vscode from "vscode";
import { AppExplorerLens } from "./app-explorer-lens";
import { MemoryAdapter } from "./card-storage";
import { makeAttachCardHandler } from "./commands/attach-card";
import { goToCardCode, makeBrowseHandler } from "./commands/browse";
import { makeNewCardHandler } from "./commands/create-card";
import { makeDebugMockClientHandler } from "./commands/debug-mock-client";
import { makeWorkspaceBoardHandler } from "./commands/manage-workspace-boards";
import { makeNavigationHandler } from "./commands/navigate";
import { makeRenameHandler } from "./commands/rename-board";
import { makeTagCardHandler } from "./commands/tag-card";
import { registerUpdateCommand } from "./commands/update-extension";
import { EditorDecorator } from "./editor-decorator";
import type { CardData } from "./EventTypes";
import { FeatureFlagManager } from "./feature-flag-manager";
import { getGitHubUrl } from "./get-github-url";
import { LocationFinder } from "./location-finder";
import { logger } from "./logger";
import { PortConfig } from "./port-config";
import { ServerDiscovery } from "./server-discovery";
import { ServerLauncher } from "./server-launcher";
import { StatusBarManager } from "./status-bar-manager";
import { WorkspaceCardStorageProxy } from "./workspace-card-storage-proxy";
import { WorkspaceWebsocketClient } from "./workspace-websocket-client";
import path = require("node:path");
import fs = require("node:fs");

const extensionLogger = logger.withPrefix("extension");
export type HandlerContext = {
  cardStorage: WorkspaceCardStorageProxy;
  waitForConnections: () => Promise<void>;
};

export async function activate(context: vscode.ExtensionContext) {
  logger.storeLogs(context.logUri);
  vscode.commands.executeCommand("setContext", "appExplorer.enabled", true);
  vscode.commands.executeCommand(
    "setContext",
    "mockMiroClient.connected",
    false,
  );

  let workspaceId = context.workspaceState.get<string | undefined>(
    "workspaceId",
  );
  if (typeof workspaceId !== "string") {
    workspaceId = `workspace-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    context.workspaceState.update("workspaceId", workspaceId);
  }

  // Initialize server discovery and launcher with configured port
  const serverPort = PortConfig.getServerPort();
  const featureFlagManager = new FeatureFlagManager(context);
  logger.initialize(featureFlagManager);

  const workspaceClient = new WorkspaceWebsocketClient({
    serverUrl: `http://localhost:${serverPort}`,
    workspaceId,
    workspaceName: vscode.workspace.name,
    rootPath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
  });
  context.subscriptions.push(workspaceClient);

  const cardStorage = new WorkspaceCardStorageProxy(
    new MemoryAdapter(),
    `http://localhost:${serverPort}`,
  );
  // Log port configuration for debugging
  extensionLogger.info("Server port configuration", {
    port: serverPort,
  });

  const serverLauncher = new ServerLauncher(
    featureFlagManager,
    new ServerDiscovery({ port: serverPort }),
  );
  context.subscriptions.push(serverLauncher);

  const serverResult = await serverLauncher.initializeServer();
  if (serverResult.mode === "server" && serverResult.server) {
    const miroServer = serverResult.server;
    context.subscriptions.push(miroServer);
    extensionLogger.info("Launched MiroServer, now switching to client mode");
  }

  extensionLogger.info("AppExplorer extension activating");
  extensionLogger.debug("Migration flags:", featureFlagManager.getFlags());

  const locationFinder = new LocationFinder();

  context.subscriptions.push(new StatusBarManager(cardStorage));

  // Create handler context with the proxy as the only CardStorage
  const handlerContext: HandlerContext = {
    cardStorage,
    async waitForConnections() {
      if (handlerContext.cardStorage.getConnectedBoards().length > 0) {
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

          while (handlerContext.cardStorage.getConnectedBoards().length === 0) {
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
        },
      );
    },
  };

  const navigateTo = async (card: CardData, preview = false) => {
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
      await handlerContext.cardStorage.query(card.boardId, "cardStatus", {
        miroLink: card.miroLink,
        status,
        codeLink,
      });
    }
    return status === "connected";
  };

  // This workspace should connect as a client
  extensionLogger.info("Running in client mode, connecting to server", {
    serverUrl: serverResult.serverUrl,
  });

  // Set up client event handlers
  workspaceClient.on("stateChange", (event) => {
    extensionLogger.debug("Workspace client state changed", {
      from: event.previousState,
      to: event.state,
    });
  });

  workspaceClient.on("error", (event) => {
    extensionLogger.error("Workspace client error", {
      error: event.error,
      code: event.code,
    });
  });

  workspaceClient.on("navigateTo", async (card) => navigateTo(card, false));

  // Connect to server
  try {
    await workspaceClient.connect();
    extensionLogger.info(
      "Successfully connected to server as workspace client",
    );

    extensionLogger.info("WorkspaceCardStorageProxy client mode enabled", {
      hasWorkspaceClient: true,
    });
  } catch (error) {
    extensionLogger.error("Failed to connect as workspace client", { error });

    // Don't show error message during tests to avoid disrupting test execution
    if (!process.env.VSCODE_TEST_MODE) {
      vscode.window.showErrorMessage(
        `AppExplorer: Failed to connect to server at ${serverResult.serverUrl}. ` +
          `Error: ${error}`,
      );
    }

    // Don't throw error - continue with extension activation to ensure commands are registered
    extensionLogger.warn(
      "Continuing extension activation despite client connection failure",
    );
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("app-explorer.connect", () => {
      // This command doesn't really need to do anything. By activating the
      // extension it will launch the webserver.
      //
      // This is useful for connecting the board for navigation purposes
      // instead of creating new cards.
    }),
    vscode.commands.registerCommand("app-explorer.internal.logFile", () => {
      return logger.getLogFile();
    }),
    new EditorDecorator(handlerContext),
    vscode.languages.registerCodeLensProvider(
      { scheme: "file" },
      new AppExplorerLens(handlerContext),
    ),
    vscode.commands.registerCommand(
      "app-explorer.navigate",
      makeNavigationHandler(handlerContext),
    ),
    vscode.commands.registerCommand(
      "app-explorer.browseCards",
      makeBrowseHandler(handlerContext, navigateTo),
    ),
    vscode.commands.registerCommand(
      "app-explorer.createCard",
      makeNewCardHandler(handlerContext),
    ),
    vscode.commands.registerCommand(
      "app-explorer.attachCard",
      makeAttachCardHandler(handlerContext),
    ),
    vscode.commands.registerCommand(
      "app-explorer.tagCard",
      makeTagCardHandler(handlerContext),
    ),
    vscode.commands.registerCommand(
      "app-explorer.renameBoard",
      makeRenameHandler(handlerContext),
    ),
    vscode.commands.registerCommand(
      "app-explorer.manageWorkspaceBoards",
      makeWorkspaceBoardHandler(handlerContext),
    ),
    vscode.commands.registerCommand(
      "app-explorer.launchMockMiroClient",
      makeDebugMockClientHandler(handlerContext, context),
    ),
  );

  registerUpdateCommand(context);
  setUpdateCommandContext(context);
  vscode.workspace.onDidChangeWorkspaceFolders(() => {
    setUpdateCommandContext(context);
  });

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
  vscode.commands.executeCommand(
    "setContext",
    "mockMiroClient.connected",
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
