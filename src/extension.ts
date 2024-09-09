import * as vscode from "vscode";
import { makeExpressServer } from "./server";
import { CardData, Queries, RequestEvents, ResponseEvents } from "./EventTypes";
import { Socket } from "socket.io";
import { makeNewCardHandler } from "./make-new-card-handler";
import { makeBrowseHandler } from "./make-browse-handler";
import { makeAttachCardHandler } from "./make-attach-card-handler";
import { getRelativePath } from "./get-relative-path";
import { makeTagCardHandler, notEmpty } from "./make-tag-card-handler";
import { AppExplorerLens, makeNavigationHandler } from "./app-explorer-lens";
import{EditorDecorator} from './editor-decorator'

export type HandlerContext = {
  statusBar: vscode.StatusBarItem;
  sockets: Map<string, Socket<ResponseEvents, RequestEvents>>;
  getCard: (link: CardData["miroLink"]) => CardData | undefined;
  readAllCards: () => CardData[],
  setCard: (link: CardData["miroLink"],card: CardData|undefined) => void;
  resetCardList: (cards: CardData[]) => void;
  selectedCards: CardData["miroLink"][];
  renderStatusBar: () => void;
  lastPosition: vscode.Position | undefined;
  waitForConnections: () => Promise<void>;
  query: <Req extends keyof Queries, Res extends ReturnType<Queries[Req]>>(
    socket: Socket<ResponseEvents, RequestEvents>,
    request: Req,
    ...data: Parameters<Queries[Req]>
  ) => Promise<Res>;
  emit: <T extends keyof RequestEvents>(
    event: T,
    ...data: Parameters<RequestEvents[T]>
  ) => void;
};

export function activate(context: vscode.ExtensionContext) {
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  // myStatusBarItem.command = myCommandId;
  context.subscriptions.push(statusBar);

  const sockets = new Map<string, Socket>();
  const allCards = new Map<CardData["miroLink"], CardData>();
  const storedCards = context.workspaceState.get<CardData[]>("cards")
  if (storedCards) {
    storedCards.forEach(card => allCards.set(card.miroLink, card))
  }

  function renderStatusBar() {
    if (sockets.size == 0) {
      statusBar.backgroundColor = "red";
    }

    let cardsInEditor = [];
    const uri = vscode.window.activeTextEditor?.document.uri;
    if (uri) {
      const path = getRelativePath(uri);
      if (path) {
        cardsInEditor = [...allCards.values()].filter(
          (card) => card?.path === path
        );
      }
    }

    if (cardsInEditor.length > 0) {
      statusBar.text = `AppExplorer (${cardsInEditor.length}/${allCards.size} cards)`;
    } else if (allCards.size > 0) {
      statusBar.text = `AppExplorer (${allCards.size} cards)`;
    } else {
      statusBar.text = `AppExplorer (${sockets.size} sockets)`;
    }
    statusBar.show();
  }
  statusBar.command = "app-explorer.browseCards";

  const handlerContext: HandlerContext = {
    statusBar,
    readAllCards: () => [...allCards.values()].filter(notEmpty),
    resetCardList: (cards) => {
      allCards.clear();
      cards.forEach((card) => allCards.set(card.miroLink, card));
    },
    getCard: (link) => allCards.get(link),
    setCard: (link, card) => {
      if (card) {
        allCards.set(link, card)
      } else {
        allCards.delete(link)
      }
      context.workspaceState.update("cards", handlerContext.readAllCards())
    },
    renderStatusBar,
    selectedCards: [],
    lastPosition: undefined,
    emit: (t, ...data) => io.emit(t, ...data),
    query: function <
      Req extends keyof Queries,
      Res extends ReturnType<Queries[Req]>
    >(
      socket: Socket<ResponseEvents, RequestEvents>,
      request: Req,
      ...data: Parameters<Queries[Req]>
    ): Promise<Res> {
      const requestId = Math.random().toString();
      return new Promise<Res>((resolve) => {
        const captureResponse: ResponseEvents["queryResult"] = (response) => {
          if (response.requestId === requestId) {
            io.off("queryResult", captureResponse);
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
        }
      );
    },
    sockets,
  };
  const io = makeExpressServer(handlerContext);
  context.subscriptions.push(
    vscode.commands.registerCommand("app-explorer.connect", () => {
      // This command doesn't really need to do anything. By activating the
      // extension it will launch the webserver.
      //
      // This is useful for connecting the board for navigation purposes
      // instead of creating new cards.
    })
  );


  new EditorDecorator(
    context,
    handlerContext
  )

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { scheme: "file" },
      new AppExplorerLens(handlerContext)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "app-explorer.navigate",
      makeNavigationHandler(handlerContext)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "app-explorer.browseCards",
      makeBrowseHandler(handlerContext)
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "app-explorer.createCard",
      makeNewCardHandler(handlerContext)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "app-explorer.attachCard",
      makeAttachCardHandler(handlerContext)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "app-explorer.tagCard",
      makeTagCardHandler(handlerContext)
    )
  );
}

export function deactivate() {}

export function selectRangeInEditor(
  range: vscode.Range,
  editor: vscode.TextEditor
) {
  const newSelection = new vscode.Selection(range.start, range.end);
  editor.selection = newSelection;
  editor.revealRange(newSelection);
}

export async function getReferencesInFile(
  document: vscode.TextDocument
): Promise<vscode.Location[]> {
  const symbols = await vscode.commands.executeCommand<
    vscode.SymbolInformation[]
  >("vscode.executeDocumentSymbolProvider", document.uri);
  const references: vscode.Location[] = [];
  for (const symbol of symbols) {
    const locations = await vscode.commands.executeCommand<vscode.Location[]>(
      "vscode.executeReferenceProvider",
      document.uri,
      symbol.location.range.start
    );
    for (const location of locations) {
      if (location.uri.toString() === document.uri.toString()) {
        references.push(location);
      }
    }
  }
  return references;
}
