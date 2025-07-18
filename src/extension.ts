import * as vscode from "vscode";
import { AppExplorerLens } from "./app-explorer-lens";
import { CardStorage, createVSCodeCardStorage } from "./card-storage";
import { makeAttachCardHandler } from "./commands/attach-card";
import { goToCardCode, makeBrowseHandler } from "./commands/browse";
import { makeNewCardHandler, UnreachableError } from "./commands/create-card";
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
import { MiroServer } from "./server";
import { ServerDiscovery } from "./server-discovery";
import { ServerHealthMonitor } from "./server-health-monitor";
import { ServerLauncher } from "./server-launcher";
import { StatusBarManager } from "./status-bar-manager";
import { WorkspaceWebsocketClient } from "./workspace-websocket-client";
import path = require("node:path");
import fs = require("node:fs");

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
  const cardStorage = createVSCodeCardStorage(context);
  const statusBarManager = new StatusBarManager(cardStorage);
  context.subscriptions.push(statusBarManager);

  const handlerContext: HandlerContext = {
    cardStorage,
    async waitForConnections() {
      if (cardStorage.getConnectedBoards().length > 0) {
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

          while (cardStorage.getConnectedBoards().length === 0) {
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
      miroServer.query(card.boardId, "cardStatus", {
        miroLink: card.miroLink,
        status,
        codeLink,
      });
    }
    return status === "connected";
  };

  // Initialize server discovery and launcher
  const serverDiscovery = new ServerDiscovery();
  const serverLauncher = new ServerLauncher(
    context,
    featureFlagManager,
    serverDiscovery,
  );

  // Initialize server based on migration flags
  extensionLogger.info("Initializing server...");
  const serverResult = await serverLauncher.initializeServer(handlerContext);

  let miroServer: MiroServer;
  let healthMonitor: ServerHealthMonitor | undefined;

  if (serverResult.mode === "server" && serverResult.server) {
    // This workspace is running the server
    miroServer = serverResult.server;
    extensionLogger.info("Running in server mode");

    // Start health monitoring if enabled
    if (featureFlagManager.isEnabled("enableServerFailover")) {
      healthMonitor = new ServerHealthMonitor(
        serverDiscovery,
        featureFlagManager,
        serverLauncher,
        handlerContext,
      );
      healthMonitor.startMonitoring();
      context.subscriptions.push({ dispose: () => healthMonitor?.dispose() });
    }
  } else if (serverResult.mode === "client") {
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

    // Connect to server
    try {
      await workspaceClient.connect();
      extensionLogger.info(
        "Successfully connected to server as workspace client",
      );
    } catch (error) {
      extensionLogger.error("Failed to connect as workspace client", { error });
      vscode.window.showErrorMessage(
        `AppExplorer: Failed to connect to server at ${serverResult.serverUrl}. ` +
          `Error: ${error}`,
      );
      throw error;
    }

    // Add client to subscriptions for cleanup
    context.subscriptions.push(workspaceClient);

    // For now, still create a MiroServer for legacy functionality
    // This ensures existing commands and Miro board connections still work
    // TODO: Phase 2 - Replace with pure client mode that proxies all operations through workspace client
    // TODO: Phase 3 - Remove MiroServer entirely from client mode once query proxying is implemented
    miroServer = await MiroServer.create(handlerContext, featureFlagManager);
  } else {
    // Fallback or error case
    extensionLogger.warn("Server initialization failed, using fallback", {
      error: serverResult.error,
    });
    miroServer = await MiroServer.create(handlerContext, featureFlagManager);
  }

  // Add server to subscriptions and set up event handling
  context.subscriptions.push(
    miroServer,
    serverLauncher,
    miroServer.event(async (event) => {
      switch (event.type) {
        case "navigateToCard": {
          navigateToCard(event.card);
          break;
        }
        case "updateCard": {
          if (event.miroLink) {
            const { card, miroLink } = event;
            if (card) {
              handlerContext.cardStorage.setCard(miroLink, card);
            } else {
              handlerContext.cardStorage.deleteCardByLink(miroLink);
            }
            statusBarManager.renderStatusBar();
          }
          break;
        }
        case "disconnect": {
          statusBarManager.renderStatusBar();
          break;
        }
        case "connect": {
          const { boardInfo } = event;
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
          statusBarManager.renderStatusBar();
          break;
        }
        default:
          throw new UnreachableError(event);
      }
    }),
  );

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
