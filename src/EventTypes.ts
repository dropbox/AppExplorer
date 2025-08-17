import { AppCard, TagColor } from "@mirohq/websdk-types";
import { BoardInfo, CardStorage } from "./card-storage";
import { SymbolPathChangeEvent } from "./document-symbol-tracker";
import { WorkspaceServerSocket } from "./server/server";

export type SymbolCardData = {
  boardId: string;
  type: "symbol";
  title: string;
  path: string;
  symbol: string;
  miroLink?: string;
  codeLink: string | null;
  status: AppCard["status"];
};

export type GroupCardData = Pick<
  SymbolCardData,
  "title" | "path" | "status" | "miroLink" | "boardId"
> & {
  type: "group";
};

export type CardData = SymbolCardData;

export const allColors = [
  "red",
  "magenta",
  "violet",
  "light_green",
  "green",
  "dark_green",
  "cyan",
  "blue",
  "dark_blue",
  "yellow",
  "gray",
  "black",
] as TagColor[];

export type AppExplorerTag = {
  title: string;
  id: string;
  color: TagColor;
};

export type ServerStatus = {
  allBoards: BoardInfo[];
  connectedBoardIds: string[];
  cardsPerBoard: Record<string, number>;
  connectedWorkspaces: Omit<WorkspaceInfo, "socket">[];
};

export type SidebarToWorkspaceOperations = {
  navigateTo: (card: CardData) => void;
};

export type SidebarToServerOperations = {
  getInstanceId: (callback: (id: string) => void) => void;
};
export type ServerToSidebarOperations = {
  serverStatus: (status: ServerStatus) => void;
  cardsAroundCursor: (data: CardData[]) => void;
};

export type WorkspaceToSidebarOperations = {
  symbolsChanged: (sombols: SymbolPathChangeEvent) => void;
};

// Operations callable on Miro boards from workspaces (via server)
// Data flow: Workspace → Server → Miro Board
export type WorkspaceToMiroOperations = {
  getIdToken: (boardId: string, callback: (id: string) => void) => void;
  setBoardName: (
    boardId: string,
    name: string,
    callback: (success: boolean) => void,
  ) => void;
  getBoardInfo: (
    boardId: string,
    callback: (boardInfo: BoardInfo) => void,
  ) => void;
  tags: (boardId: string, callback: (tags: AppExplorerTag[]) => void) => void;
  attachCard: (
    boardId: string,
    data: CardData,
    callback: (success: boolean) => void,
  ) => void;
  tagCards: (
    boardId: string,
    data: {
      miroLink: string[];
      tag:
        | string
        | {
            color: TagColor;
            title: string;
          };
    },
    callback: (success: boolean) => void,
  ) => void;
  selectCard: (
    boardId: string,
    miroLink: string,
    callback: (success: boolean) => void,
  ) => void;
  cardStatus: (
    boardId: string,
    data: {
      miroLink: string;
      status: "connected" | "disconnected";
      codeLink: string | null;
    },
    callback: (success: boolean) => void,
  ) => void;
  cards: (boardId: string, callback: (cards: CardData[]) => void) => void;
  selected: (boardId: string, callback: (cards: CardData[]) => void) => void;
  newCards: (
    boardId: string,
    data: CardData[],
    options: { connect?: string[] },
    callback: (success: boolean) => void,
  ) => void;
  hoverCard: (
    boardId: string,
    miroLink: string,
    callback: (success: boolean) => void,
  ) => void;
};

export type ServerToWorkspaceEvents = {
  connectedBoards: (boards: string[]) => void;
  boardUpdate: (board: BoardInfo | null) => void;
  cardUpdate: (url: string, card: CardData | null) => void;
};

// Event notifications sent from server to workspace clients
// Data flow: Server → Workspace (routed through server)
export type MiroToWorkspaceOperations = {
  // Core workspace events
  selectedCards: (data: CardData[]) => void;
  navigateTo: (card: CardData) => void;
  card: (data: { url: string; card: CardData | null }) => void;
  log: (args: unknown[]) => void;
};

// Operations callable on server from workspaces
// Data flow: Workspace → Server
export type WorkspaceToServerOperations = {
  workspaceRegistration: (
    request: WorkspaceRegistrationRequest,
    callback: (response: WorkspaceRegistrationResponse) => void,
  ) => void;
};

export type EventMapType = {
  // This does need to use any, it doesn't work with unknown
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [K: string]: (...args: any[]) => any;
};

// Server Health Check Configuration

export interface ServerHealthCheck {
  endpoint: string; // Health check endpoint path
  timeout: number; // Request timeout in milliseconds
  retryInterval: number; // Interval between health checks in milliseconds
  maxRetries: number; // Maximum consecutive failures before considering server down
}

export const DEFAULT_HEALTH_CHECK_CONFIG: ServerHealthCheck = {
  endpoint: "/health",
  timeout: 5000, // 5 seconds
  retryInterval: 10000, // 10 seconds
  maxRetries: 3,
};

export interface WorkspaceInfo {
  id: string; // Unique workspace identifier
  socket: WorkspaceServerSocket;
  workspaceName?: string;
  rootPath?: string;
}

export interface WorkspaceRegistrationRequest {
  workspaceId: string;
  workspaceName?: string;
  rootPath?: string;
}

export interface WorkspaceRegistrationResponse {
  success: boolean;
  workspaceId: string;
  error?: string;
  cardsByBoard: ReturnType<CardStorage["getCardsByBoard"]>;
}
