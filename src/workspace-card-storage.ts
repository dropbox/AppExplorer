import { Socket, io as socketIO } from "socket.io-client";
import * as vscode from "vscode";
import { BoardInfo, CardStorage, StorageAdapter } from "./card-storage";
import { goToCardCode } from "./commands/browse";
import {
  CardData,
  MiroToWorkspaceOperations,
  ServerToWorkspaceEvents,
  WorkspaceRegistrationRequest,
  WorkspaceToMiroOperations,
  WorkspaceToServerOperations,
} from "./EventTypes";
import { getGitHubUrl } from "./get-github-url";
import { LocationFinder } from "./location-finder";
import { createLogger } from "./logger";
import { bindHandlers } from "./utils/bindHandlers";
import { promiseEmit } from "./utils/promise-emit";

const logger = createLogger("workspace-card-storage");

export class WorkspaceCardStorage
  extends CardStorage
  implements
    vscode.Disposable,
    MiroToWorkspaceOperations,
    ServerToWorkspaceEvents
{
  public readonly socket: Socket<
    ServerToWorkspaceEvents & MiroToWorkspaceOperations,
    WorkspaceToMiroOperations & WorkspaceToServerOperations
  >;

  constructor(
    workspaceId: string,
    storageAdapter: StorageAdapter,
    serverUrl: string,
    private locationFinder: LocationFinder,
  ) {
    super(storageAdapter);

    const wsUrl = `${serverUrl}/workspace`;
    const connectionTimeout = 10000; // 10 second connection timeout

    this.socket = socketIO(wsUrl, {
      transports: ["websocket"],
      timeout: connectionTimeout,
      reconnection: true,
      forceNew: true, // Force new connection on each attempt
    });
    this.socket.onAny((event, ...args) => {
      logger.debug("Received server event", this.socket.id, {
        event,
        args,
      });
    });
    this.socket.onAnyOutgoing((event, ...args) => {
      logger.debug("Sending server event", this.socket.id, {
        event,
        args,
      });
    });
    this.socket.on("disconnect", () => {
      logger.warn("Socket disconnected", { id: this.socket.id });
      this.emit("disconnect");
    });

    const ServerToWorkspaceEvents: ServerToWorkspaceEvents = {
      connectedBoards: this.connectedBoards.bind(this),
      boardUpdate: this.boardUpdate.bind(this),
      cardUpdate: this.cardUpdate.bind(this),
    };
    bindHandlers(this.socket, ServerToWorkspaceEvents);

    const miroToWorkspace: MiroToWorkspaceOperations = {
      card: this.card.bind(this),
      navigateTo: this.navigateTo.bind(this),
      selectedCards: this.selectedCards.bind(this),
    };
    bindHandlers(this.socket, miroToWorkspace);

    // Register with server when connected
    this.socket.on("connect", async () => {
      logger.info("Connected to server, registering workspace");
      try {
        const registrationRequest: WorkspaceRegistrationRequest = {
          workspaceId,
          workspaceName: vscode.workspace.name || "Unknown Workspace",
          rootPath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
        };

        const response = await promiseEmit(
          this.socket,
          "workspaceRegistration",
          registrationRequest,
        );
        this.setCardsByBoard(response.cardsByBoard);

        logger.info("Workspace registration", { workspaceId });
      } catch (error) {
        logger.error("Failed to register workspace", { error });
      }
    });
  }

  async disconnectBoard(boardId: string) {
    return super.disconnectBoard(
      boardId,
      /**
       * The server will delete cards on disconnection, but not workspaces.
       */
      false,
    );
  }

  selectedCards(data: CardData[]): void {
    logger.debug("Received selected cards", { data });
    return super.selectedCards(data);
  }
  connectedBoards(boardIds: string[]) {
    logger.debug("Received connected boards", { boardIds });
    this.connectedBoardSet = new Set(boardIds);
    this.emit("connectedBoards", {
      type: "connectedBoards",
      boardIds: boardIds,
    });
  }
  boardUpdate(board: BoardInfo | null) {
    logger.debug("Received board update", { board });
    if (board) {
      this.setBoardName(board.boardId, board.name);
      this.setBoardCards(board.boardId, Object.values(board.cards));
    }
  }
  async cardUpdate(url: string, card: CardData | null) {
    logger.debug("Received card update", { url, card });
    try {
      if (card) {
        await this.setCard(card.boardId, card);
      } else {
        this.deleteCardByLink(url);
      }
    } catch (error) {
      logger.error("Error handling cardUpdate event", {
        error: String(error),
        url,
        card,
      });
    }
  }

  async card({ url, card }: { url: string; card: CardData | null }) {
    logger.debug("Received card event", { url, card });
    try {
      if (card) {
        await this.setCard(card.boardId, card);
      } else {
        this.deleteCardByLink(url);
      }
    } catch (error) {
      logger.error("Error handling card event", {
        error: String(error),
        url,
        card,
      });
    }
  }

  public navigateTo = async (card: CardData, preview = false) => {
    logger.debug("Navigating to card", { card, preview });
    const dest = await this.locationFinder.findCardDestination(card);

    // Only connect if it's able to reach the symbol
    const success = await goToCardCode(card, preview);
    const status = success ? "connected" : "disconnected";

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
        let updatedCard: CardData;

        if (card.type === "symbol") {
          updatedCard = {
            ...card,
            status,
            codeLink: codeLink ?? null,
          };
        } else {
          updatedCard = {
            ...card,
            status,
          };
        }

        try {
          await this.setCard(card.boardId, updatedCard);
        } catch (error) {
          // If the board doesn't exist in the workspace, create it first
          if (
            error instanceof Error &&
            error.message.includes("Board not found")
          ) {
            logger.info("Board not found in workspace, creating it", {
              boardId: card.boardId,
            });
            // Create the board with a default name
            await this.addBoard(card.boardId, `Board ${card.boardId}`);
            // Now try to set the card again
            await this.setCard(card.boardId, updatedCard);
          } else {
            throw error;
          }
        }
      }

      await promiseEmit(this.socket, "cardStatus", card.boardId, {
        miroLink: card.miroLink,
        status,
        codeLink,
      });
    }
    logger.debug("🔍 Returning from navigateTo", {
      connected: status === "connected",
    });
    return status === "connected";
  };
}
