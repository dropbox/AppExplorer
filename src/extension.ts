import fs from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import { AppExplorerLens } from "./app-explorer-lens";
import { MemoryAdapter } from "./card-storage";
import { makeAttachCardHandler } from "./commands/attach-card";
import { makeBrowseHandler } from "./commands/browse";
import { makeNewCardHandler } from "./commands/create-card";
import { makeDebugMockClientHandler } from "./commands/debug-mock-client";
import { makeWorkspaceBoardHandler } from "./commands/manage-workspace-boards";
import { makeNavigationHandler } from "./commands/navigate";
import { makeRenameHandler } from "./commands/rename-board";
import { makeTagCardHandler } from "./commands/tag-card";
import { registerUpdateCommand } from "./commands/update-extension";
import { EditorDecorator } from "./editor-decorator";
import { FeatureFlagManager } from "./feature-flag-manager";
import { LocationFinder } from "./location-finder";
import { logger as baseLogger, logger } from "./logger";
import { PortConfig } from "./port-config";
import { ServerDiscovery } from "./server-discovery";
import { ServerLauncher } from "./server-launcher";
import { MiroServer } from "./server/server";
import { StatusBarManager } from "./status-bar-manager";
import { listenToAllEvents } from "./test/helpers/listen-to-all-events";
import { createDebug } from "./utils/create-debug";
import { CHECKPOINT } from "./utils/log-checkpoint";
import { WorkspaceCardStorage } from "./workspace-card-storage";
const debug = createDebug("app-explorer:extension");
export type HandlerContext = {
  cardStorage: WorkspaceCardStorage;
  waitForConnections: () => Promise<void>;
};

export async function activate(context: vscode.ExtensionContext) {
  logger.storeLogs(context.logUri);
  debug(CHECKPOINT.start("activate"));
  setUpdateCommandContext(context);
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
  baseLogger.initialize();

  const locationFinder = new LocationFinder();
  const cardStorage = new WorkspaceCardStorage(
    workspaceId,
    // new VSCodeAdapter(context),
    new MemoryAdapter(),
    `http://localhost:${serverPort}`,
    locationFinder,
  );
  listenToAllEvents(cardStorage, (eventName, ...args) => {
    debug("storage event", eventName, args);
  });
  // Log port configuration for debugging
  debug("Server port configuration", {
    port: serverPort,
  });

  const serverLauncher = new ServerLauncher(
    featureFlagManager,
    workspaceId,
    new ServerDiscovery({ port: serverPort }),
  );
  context.subscriptions.push(serverLauncher);

  const serverResult = await serverLauncher.initializeServer();
  cardStorage.on("disconnect", () => {
    debug("Server disconnected");
    return serverLauncher.initializeServer();
  });

  debug("AppExplorer extension activating");
  debug("Migration flags:", featureFlagManager.getFlags());

  context.subscriptions.push(new StatusBarManager(cardStorage));

  // Create handler context with the proxy as the only CardStorage
  const handlerContext: HandlerContext = {
    cardStorage,
    async waitForConnections() {
      debug("Waiting for connections...");
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
            debug("User canceled the long running operation");
          });

          while (handlerContext.cardStorage.getConnectedBoards().length === 0) {
            debug(
              "Waiting for connections...",
              cardStorage.getConnectedBoards(),
            );
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
        },
      );
      debug("Finished waiting for connections");
    },
  };

  // This workspace should connect as a client
  debug("Running in client mode, connecting to server", {
    serverUrl: serverResult.serverUrl,
  });

  // Connect to server
  try {
    await cardStorage.socket.connect();
    debug("Successfully connected to server as workspace client");

    debug("WorkspaceCardStorageProxy client mode enabled", {
      hasWorkspaceClient: true,
    });
  } catch (error) {
    debug("Failed to connect as workspace client", { error });

    // Don't show error message during tests to avoid disrupting test execution
    if (!process.env.VSCODE_TEST_MODE) {
      vscode.window.showErrorMessage(
        `AppExplorer: Failed to connect to server at ${serverResult.serverUrl}. ` +
          `Error: ${error}`,
      );
    }

    // Don't throw error - continue with extension activation to ensure commands are registered
    debug("Continuing extension activation despite client connection failure");
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("app-explorer.connect", () => {
      // This command doesn't really need to do anything. By activating the
      // extension it will launch the webserver.
      //
      // This is useful for connecting the board for navigation purposes
      // instead of creating new cards.
    }),
    vscode.commands.registerCommand(
      "app-explorer.internal.logFile",
      (DEBUG: string) => {
        return baseLogger.getLogFile(DEBUG);
      },
    ),
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
      makeBrowseHandler(handlerContext),
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
  vscode.workspace.onDidChangeWorkspaceFolders(() => {
    setUpdateCommandContext(context);
  });

  debug(CHECKPOINT.done("activate"));
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
            MiroServer.publicPath = path.join(
              path.dirname(packageJsonPath),
              "public",
            );
            break;
          }
          debug("public path", MiroServer.publicPath);
        } catch (error) {
          debug("Error parsing package.json:", error);
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
