import createDebug from "debug";
import { Namespace, Socket } from "socket.io";
import {
  ServerToSidebarOperations,
  SidebarToServerOperations,
  WorkspaceInfo,
} from "../EventTypes";
import { BoardInfo, CardStorage } from "../card-storage";

const debug = createDebug("app-explorer:server:sidebar");

type SidebarNamespace = Namespace<
  SidebarToServerOperations,
  ServerToSidebarOperations
>;

export class SidebarServer {
  private sidebarNamespace: SidebarNamespace;
  private cardStorage: CardStorage;

  private connectedWorkspaces: Map<string, WorkspaceInfo>;
  constructor(
    namespace: SidebarNamespace,
    cardStorage: CardStorage,
    workspaceInfo: Map<string, WorkspaceInfo>,
  ) {
    namespace.use((event, next) => {
      debug("sidebar event", event);
      next();
    });
    this.sidebarNamespace = namespace;

    this.cardStorage = cardStorage;
    this.connectedWorkspaces = workspaceInfo;

    this.sidebarNamespace.on("connection", this.onSidebarConnection);
    this.cardStorage.on("boardUpdate", this.emitServerStatus);
    this.cardStorage.on("connectedBoards", this.emitServerStatus);
    this.cardStorage.on("workspaceBoards", this.emitServerStatus);
  }

  destroy() {
    this.sidebarNamespace.off("connection", this.onSidebarConnection);
    this.cardStorage.off("boardUpdate", this.emitServerStatus);
    this.cardStorage.off("connectedBoards", this.emitServerStatus);
    this.cardStorage.off("workspaceBoards", this.emitServerStatus);
  }

  onSidebarConnection = (
    socket: Socket<SidebarToServerOperations, ServerToSidebarOperations>,
  ) => {
    debug("New sidebar connection", { socketId: socket.id });

    setTimeout(this.emitServerStatus, 1000);
  };

  getServerStatus = () => {
    const cardsByBoard = this.cardStorage.getCardsByBoard();
    const allBoards = Object.keys(cardsByBoard)
      .map((id) => this.cardStorage.getBoard(id))
      .filter((board): board is BoardInfo => board !== null);
    return {
      allBoards,
      connectedWorkspaces: Array.from(this.connectedWorkspaces.values()).map(
        (workspace) => ({
          ...workspace,
          socket: undefined,
        }),
      ),
      connectedBoardIds: this.cardStorage.getConnectedBoards(),
      cardsPerBoard: Object.fromEntries(
        Object.entries(cardsByBoard).map(([boardId, cards]) => [
          boardId,
          cards.length,
        ]),
      ),
    };
  };
  emitServerStatus = () => {
    debug("Emitting server status");
    this.sidebarNamespace.emit("serverStatus", this.getServerStatus());
  };
}
