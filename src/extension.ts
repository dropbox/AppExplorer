import * as vscode from "vscode";
import { AppExplorerLens } from "./app-explorer-lens";
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
import { DEFAULT_PRODUCTION_PORT, PortConfig } from "./port-config";
import { MiroServer } from "./server";
import { ServerDiscovery } from "./server-discovery";
import { ServerHealthMonitor } from "./server-health-monitor";
import { ServerLauncher } from "./server-launcher";
import { StatusBarManager } from "./status-bar-manager";
import { WorkspaceCardStorageProxy } from "./workspace-card-storage-proxy";
import { WorkspaceWebsocketClient } from "./workspace-websocket-client";
import path = require("node:path");
import fs = require("node:fs");

export type HandlerContext = {
  cardStorage: WorkspaceCardStorageProxy;
  waitForConnections: () => Promise<void>;
};

export async function activate(context: vscode.ExtensionContext) {
  logger.storeLogs(context.logUri);
  registerUpdateCommand(context);
  setUpdateCommandContext(context);
  vscode.workspace.onDidChangeWorkspaceFolders(() => {
    setUpdateCommandContext(context);
  });

  vscode.commands.executeCommand("setContext", "appExplorer.enabled", true);

  // Initialize MockMiro context (disabled by default)
  vscode.commands.executeCommand(
    "setContext",
    "mockMiroClient.connected",
    false,
  );

  // Initialize feature flag manager for migration
  const featureFlagManager = new FeatureFlagManager(context);

  // Initialize logger with feature flag manager
  logger.initialize(featureFlagManager);

  // Create extension logger
  const extensionLogger = logger.withPrefix("extension");
  extensionLogger.info("AppExplorer extension activating");
  extensionLogger.debug("Migration flags:", featureFlagManager.getFlags());

  const locationFinder = new LocationFinder();

  // Create WorkspaceCardStorageProxy as the single CardStorage implementation
  // This eliminates the dual storage pattern and circular dependencies
  const cardStorage = new WorkspaceCardStorageProxy(
    context,
    featureFlagManager,
    // workspaceClient will be set later when available
  );

  const statusBarManager = new StatusBarManager(cardStorage);
  context.subscriptions.push(statusBarManager);

  // Create handler context with the proxy as the only CardStorage
  const handlerContext: HandlerContext = {
    cardStorage: cardStorage,
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
      await handlerContext.cardStorage.query(card.boardId, "cardStatus", {
        miroLink: card.miroLink,
        status,
        codeLink,
      });
    }
    return status === "connected";
  };

  // Initialize server discovery and launcher with configured port
  const serverPort = PortConfig.getServerPort();

  const serverDiscovery = new ServerDiscovery({ port: serverPort });
  const serverLauncher = new ServerLauncher(
    context,
    featureFlagManager,
    serverDiscovery,
  );

  // Log port configuration for debugging
  extensionLogger.info("Server port configuration", {
    port: serverPort,
  });

  // Initialize server based on migration flags
  extensionLogger.info("Initializing server...");
  const serverResult = await serverLauncher.initializeServer(handlerContext);

  let healthMonitor: ServerHealthMonitor | undefined;

  if (serverResult.mode === "server" && serverResult.server) {
    // This workspace launched the server - now switch to client mode
    const miroServer = serverResult.server;
    context.subscriptions.push(miroServer);
    extensionLogger.info("Launched MiroServer, now switching to client mode");

    // Start health monitoring (always enabled)
    healthMonitor = new ServerHealthMonitor(
      serverDiscovery,
      featureFlagManager,
      serverLauncher,
      handlerContext,
    );
    healthMonitor.startMonitoring();
    context.subscriptions.push({ dispose: () => healthMonitor?.dispose() });
  }
  if (serverResult.mode !== "disabled") {
    // This workspace should connect as a client
    extensionLogger.info("Running in client mode, connecting to server", {
      serverUrl: serverResult.serverUrl,
    });

    // Create workspace websocket client
    const workspaceId = `workspace-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const workspaceClient = new WorkspaceWebsocketClient(
      {
        serverUrl: serverResult.serverUrl!,
        workspaceId,
        workspaceName: vscode.workspace.name,
        rootPath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      },
      featureFlagManager,
      handlerContext,
    );

    // Set up client event handlers
    workspaceClient.on("stateChange", (event) => {
      extensionLogger.debug("Workspace client state changed", {
        from: event.previousState,
        to: event.state,
      });
    });

    workspaceClient.on("registrationComplete", (event) => {
      extensionLogger.info("Workspace registration complete", {
        workspaceId: event.response.workspaceId,
        assignedBoards: event.response.assignedBoards,
      });
    });

    workspaceClient.on("error", (event) => {
      extensionLogger.error("Workspace client error", {
        error: event.error,
        code: event.code,
      });
    });

    // Connect navigation events from Miro to actual navigation function
    workspaceClient.on("navigateToCard", async (event: { card: CardData }) => {
      extensionLogger.info("🎯 NAVIGATION EVENT: Executing card navigation", {
        timestamp: new Date().toISOString(),
        cardTitle: event.card.title,
        cardPath: event.card.path,
        cardSymbol:
          event.card.type === "symbol" ? event.card.symbol : undefined,
        eventSource: "workspace-websocket-client",
      });

      try {
        // Call the actual navigation function
        const success = await navigateToCard(event.card, false);
        extensionLogger.info(
          "🎯 NAVIGATION RESULT: Card navigation completed",
          {
            timestamp: new Date().toISOString(),
            cardTitle: event.card.title,
            success,
          },
        );
      } catch (error) {
        extensionLogger.error(
          "❌ NAVIGATION ERROR: Failed to navigate to card",
          {
            timestamp: new Date().toISOString(),
            cardTitle: event.card.title,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    });

    // Connect to server
    try {
      await workspaceClient.connect();
      extensionLogger.info(
        "Successfully connected to server as workspace client",
      );

      // Set the workspace client for proxy operations
      // Since WorkspaceCardStorageProxy was created early, we just need to set the client
      extensionLogger.info("Setting workspace client for proxy operations");

      handlerContext.cardStorage.setWorkspaceClient(workspaceClient);

      extensionLogger.info("WorkspaceCardStorageProxy client mode enabled", {
        hasWorkspaceClient: true,
        proxyStats: handlerContext.cardStorage.getProxyStats(),
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

    // Add client to subscriptions for cleanup
    context.subscriptions.push(workspaceClient);
  } else {
    extensionLogger.warn("Server initialization failed, using fallback", {
      error: serverResult.error,
    });
    try {
      extensionLogger.info("Creating fallback MiroServer", { serverPort });
      const miroServer = await MiroServer.create(
        handlerContext,
        featureFlagManager,
        serverPort,
      );
      context.subscriptions.push(miroServer);
      extensionLogger.info("Fallback MiroServer created successfully", {
        serverPort,
      });
    } catch (error) {
      extensionLogger.error(
        "Fallback MiroServer creation failed, creating minimal server",
        {
          error: error instanceof Error ? error.message : String(error),
          originalPort: serverPort,
          fallbackPort: DEFAULT_PRODUCTION_PORT,
        },
      );
      // Create a minimal server instance that won't interfere with command registration
      const miroServer = await MiroServer.create(
        handlerContext,
        featureFlagManager,
        DEFAULT_PRODUCTION_PORT, // Use safe default port
      );
      context.subscriptions.push(miroServer);
      extensionLogger.info("Minimal MiroServer created", {
        port: DEFAULT_PRODUCTION_PORT,
      });
    }
  }

  // Add server launcher to subscriptions
  context.subscriptions.push(serverLauncher);

  // NOTE: In the corrected architecture, ALL workspace instances operate in CLIENT mode
  // Events are now handled through WorkspaceCardStorageProxy, not direct miroServer events
  // The WorkspaceCardStorageProxy receives events from the central server and handles:
  // - navigateToCard: Navigation events from Miro boards
  // - updateCard: Card updates and synchronization
  // - connect/disconnect: Board connection status changes
  // This ensures consistent behavior across all workspace instances

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
      makeBrowseHandler(handlerContext, navigateToCard),
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
