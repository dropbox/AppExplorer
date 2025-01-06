import * as vscode from "vscode";
import { AppExplorerLens } from "./app-explorer-lens";
import { CardStorage } from "./card-storage";
import { makeAttachCardHandler } from "./commands/attach-card";
import {
  findCardDestination,
  goToCardCode,
  makeBrowseHandler,
} from "./commands/browse";
import { makeNewCardHandler } from "./commands/create-card";
import { makeWorkspaceBoardHandler } from "./commands/manage-workspace-boards";
import { makeNavigationHandler } from "./commands/navigate";
import { makeRenameHandler } from "./commands/rename-board";
import { makeTagCardHandler } from "./commands/tag-card";
import { EditorDecorator } from "./editor-decorator";
import type { CardData } from "./EventTypes";
import { getGitHubUrl } from "./get-github-url";
import { isWebserverRunning, MiroServer } from "./server";
import { StatusBarManager } from "./status-bar-manager";
import { logger } from "./ChannelLogger";

export type HandlerContext = {
  mode: "host" | "client";
  cardStorage: CardStorage;
  waitForConnections: () => Promise<void>;
};

export async function activate(context: vscode.ExtensionContext) {
  vscode.commands.executeCommand("setContext", "appExplorer.enabled", true);
  context.subscriptions.push(logger);

  const cardStorage = new CardStorage(context);
  const statusBarManager = new StatusBarManager(cardStorage);
  context.subscriptions.push(statusBarManager);
  statusBarManager.renderStatusBar();
  const mode = (await isWebserverRunning()) ? "client" : "host";
  logger.log("mode:", mode);

  const handlerContext: HandlerContext = {
    mode,
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
            logger.log("User canceled the long running operation");
          });

          while (cardStorage.getConnectedBoards().length === 0) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            statusBarManager.renderStatusBar();
          }
        },
      );
    },
  };

  const navigateToCard = async (card: CardData, preview = false) => {
    const dest = await findCardDestination(card);

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

  const miroServer = new MiroServer(handlerContext);
  context.subscriptions.push(
    miroServer,
    miroServer.event(async (event) => {
      logger.log("Miro event", event.type, Object.keys(event));
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
          }
          break;
        }
        case "disconnect": {
          break;
        }
        case "connect": {
          const { boardInfo } = event;
          logger.log("Connected to board", boardInfo.id, boardInfo.name, {
            cards: boardInfo.cards.length,
          });
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
          break;
        }
        default:
        // throw new UnreachableError(event);
      }
      statusBarManager.renderStatusBar();
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
  );

  return {
    // IDK what to use this for, I just want to verify it works.
    appExplorer: true,
  };
}

export function deactivate() {
  vscode.commands.executeCommand("setContext", "appExplorer.enabled", false);
}

export function selectRangeInEditor(
  range: vscode.Range,
  editor: vscode.TextEditor,
) {
  const newSelection = new vscode.Selection(range.start, range.end);
  editor.selection = newSelection;
  editor.revealRange(newSelection);
}

export async function getReferencesInFile(
  document: vscode.TextDocument,
): Promise<vscode.Location[]> {
  const symbols = await vscode.commands.executeCommand<
    vscode.SymbolInformation[]
  >("vscode.executeDocumentSymbolProvider", document.uri);
  const references: vscode.Location[] = [];
  for (const symbol of symbols) {
    const locations = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeReferenceProvider",
      document.uri,
      symbol.location.range.start,
    );
    for (const location of locations) {
      if (location.uri.toString() === document.uri.toString()) {
        references.push(location);
      }
    }
  }
  return references;
}
