import * as vscode from "vscode";
import { makeExpressServer } from "./server";
import type {
  CardData,
  Queries,
  RequestEvents,
  ResponseEvents,
} from "./EventTypes";
import type { Socket } from "socket.io";
import { makeNewCardHandler } from "./commands/create-card";
import {
  findCardDestination,
  goToCardCode,
  makeBrowseHandler,
} from "./commands/browse";
import { makeAttachCardHandler } from "./commands/attach-card";
import { makeTagCardHandler } from "./commands/tag-card";
import { makeRenameHandler } from "./commands/rename-board";
import { makeNavigationHandler } from "./commands/navigate";
import { AppExplorerLens } from "./app-explorer-lens";
import { EditorDecorator } from "./editor-decorator";
import { StatusBarManager } from "./status-bar-manager";
import { CardStorage } from "./card-storage";
import { getGitHubUrl } from "./get-github-url";
import { makeWorkspaceBoardHandler } from "./commands/manage-workspace-boards";

export type HandlerContext = {
  cardStorage: CardStorage;
  connectedBoards: Set<string>;
  renderStatusBar: () => void;
  waitForConnections: () => Promise<void>;
  query: <Req extends keyof Queries, Res extends ReturnType<Queries[Req]>>(
    boardId: string | Socket<ResponseEvents, RequestEvents>,
    request: Req,
    ...data: Parameters<Queries[Req]>
  ) => Promise<Res>;
};

export async function activate(context: vscode.ExtensionContext) {
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
    renderStatusBar: statusBarManager.renderStatusBar.bind(statusBarManager),
    query: function <
      Req extends keyof Queries,
      Res extends ReturnType<Queries[Req]>,
    >(
      socket: Socket<ResponseEvents, RequestEvents> | string,
      request: Req,
      ...data: Parameters<Queries[Req]>
    ): Promise<Res> {
      if (typeof socket === "string") {
        const s = sockets.get(socket);
        if (!s) {
          throw new Error(`Socket not found for boardId: ${socket}`);
        }
        return handlerContext.query(s, request, ...data);
      }

      const requestId = Math.random().toString(36);
      return new Promise<Res>((resolve) => {
        const captureResponse: ResponseEvents["queryResult"] = (response) => {
          if (response.requestId === requestId) {
            socket.off("queryResult", captureResponse);
            resolve(response.response as Res);
          }
        };

        socket.on("queryResult", captureResponse);

        socket.emit("query", {
          name: request,
          requestId,
          data,
        });
      });
    },
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
      handlerContext.query(card.boardId, "cardStatus", {
        miroLink: card.miroLink,
        status,
        codeLink,
      });
    }
    return status === "connected";
  };

  makeExpressServer(handlerContext, sockets, navigateToCard);
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
      makeNavigationHandler(handlerContext),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "app-explorer.browseCards",
      makeBrowseHandler(handlerContext, navigateToCard),
    ),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "app-explorer.createCard",
      makeNewCardHandler(handlerContext),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "app-explorer.attachCard",
      makeAttachCardHandler(handlerContext),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "app-explorer.tagCard",
      makeTagCardHandler(handlerContext),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "app-explorer.renameBoard",
      makeRenameHandler(handlerContext),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "app-explorer.manageWorkspaceBoards",
      makeWorkspaceBoardHandler(handlerContext),
    ),
  );
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

interface BaseEvent {
  requestId: string;
  boardId: string;
}

export interface RequestEvent<Req extends keyof Queries = keyof Queries>
  extends BaseEvent {
  type: "request";
  request: Req;
  data: Parameters<Queries[Req]>;
}

export interface ResponseEvent<Req extends keyof Queries = keyof Queries>
  extends BaseEvent {
  type: "response";
  request: Req;
  data: ReturnType<Queries[Req]>;
}

export class EventQueries {
  private eventeEmitter = new vscode.EventEmitter<
    RequestEvent | ResponseEvent
  >();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private resolvers: Record<string, (data: any) => void> = {};

  constructor() {
    this.eventeEmitter.event((event) => {
      if (event.type === "response") {
        this.resolvers[event.requestId](event.data);
        delete this.resolvers[event.requestId];
      }
    });
  }

  dispose() {
    this.eventeEmitter.dispose();
  }

  query<Req extends keyof Queries, Res extends ReturnType<Queries[Req]>>(
    boardId: string,
    request: Req,
    ...data: Parameters<Queries[Req]>
  ): Promise<Res> {
    const requestId = Math.random().toString(36);
    return new Promise<Res>((resolve) => {
      this.resolvers[requestId] = resolve;
      this.eventeEmitter.fire({
        type: "request",
        requestId,
        boardId,
        request,
        data,
      });
    });
  }

  queryHandler<Req extends keyof Queries, Res extends ReturnType<Queries[Req]>>(
    boardId: string,
    request: Req,
    handler: (...data: Parameters<Queries[Req]>) => Promise<Res>,
  ) {
    this.eventeEmitter.event(async (event) => {
      if (
        event.type === "request" &&
        event.request === request &&
        event.boardId === boardId
      ) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = await handler(...(event.data as any));
        this.eventeEmitter.fire({
          type: "response",
          requestId: event.requestId,
          boardId,
          request,
          data,
        });
      }
    });
  }
}
