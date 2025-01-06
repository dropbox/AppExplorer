import type { Socket } from "socket.io";
import * as vscode from "vscode";
import { AppExplorerLens } from "./app-explorer-lens";
import { CardStorage } from "./card-storage";
import { makeAttachCardHandler } from "./commands/attach-card";
import {
  findCardDestination,
  goToCardCode,
  makeBrowseHandler,
} from "./commands/browse";
import { makeNewCardHandler, UnreachableError } from "./commands/create-card";
import { makeWorkspaceBoardHandler } from "./commands/manage-workspace-boards";
import { makeNavigationHandler } from "./commands/navigate";
import { makeRenameHandler } from "./commands/rename-board";
import { makeTagCardHandler } from "./commands/tag-card";
import { EditorDecorator } from "./editor-decorator";
import type { CardData } from "./EventTypes";
import { getGitHubUrl } from "./get-github-url";
import { MiroServer } from "./server";
import { StatusBarManager } from "./status-bar-manager";

export type HandlerContext = {
  cardStorage: CardStorage;
  connectedBoards: Set<string>;
  waitForConnections: () => Promise<void>;
};

export async function activate(context: vscode.ExtensionContext) {
  vscode.commands.executeCommand("setContext", "appExplorer.enabled", true);

  const cardStorage = new CardStorage(context);
  const sockets = new Map<string, Socket>();
  const connectedBoards = new Set<string>();
  const statusBarManager = new StatusBarManager(
    connectedBoards,
    cardStorage,
    context,
  );

  const handlerContext: HandlerContext = {
    cardStorage,
    connectedBoards,
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

  const miroServer = new MiroServer(handlerContext, sockets);
  context.subscriptions.push(miroServer);
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
  });

  context.subscriptions.push(
    vscode.commands.registerCommand("app-explorer.connect", () => {
      // This command doesn't really need to do anything. By activating the
      // extension it will launch the webserver.
      //
      // This is useful for connecting the board for navigation purposes
      // instead of creating new cards.
    }),
  );

  new EditorDecorator(context, handlerContext);

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { scheme: "file" },
      new AppExplorerLens(handlerContext),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "app-explorer.navigate",
      makeNavigationHandler(handlerContext, miroServer),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "app-explorer.browseCards",
      makeBrowseHandler(handlerContext, navigateToCard, miroServer),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "app-explorer.createCard",
      makeNewCardHandler(handlerContext, miroServer),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "app-explorer.attachCard",
      makeAttachCardHandler(handlerContext, miroServer),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "app-explorer.tagCard",
      makeTagCardHandler(handlerContext, miroServer),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "app-explorer.renameBoard",
      makeRenameHandler(handlerContext, miroServer),
    ),
  );

  context.subscriptions.push(
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

export function deactivate() {}

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
