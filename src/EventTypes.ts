import { AppCard, TagColor } from "@mirohq/websdk-types";
import { BoardInfo } from "./card-storage";
import { WorkspaceServerSocket } from "./server";

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

export type CardData = SymbolCardData | GroupCardData;

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

/**
 * This type is used in callbacks to represent whatever error might return.
 * Anything can be thrown and any promise can be rejected with anything. So a named type means I don't have to disable the lint rule everywhere.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyError = any;

type SuccessCallback = (success: boolean) => void;

// Operations callable on Miro boards from workspaces (via server)
// Data flow: Workspace → Server → Miro Board
export type WorkspaceToMiroOperations = {
  getIdToken: (boardId: string, callback: (id: string) => void) => void;
  setBoardName: (
    boardId: string,
    name: string,
    callback: SuccessCallback,
  ) => void;
  getBoardInfo: (
    boardId: string,
    callback: (boardInfo: BoardInfo) => void,
  ) => void;
  tags: (boardId: string, callback: (tags: AppExplorerTag[]) => void) => void;
  attachCard: (
    boardId: string,
    data: CardData,
    callback: SuccessCallback,
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
    callback: SuccessCallback,
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
    callback: SuccessCallback,
  ) => void;
  cards: (boardId: string, callback: (cards: CardData[]) => void) => void;
  selected: (boardId: string, callback: (cards: CardData[]) => void) => void;
  newCards: (
    boardId: string,
    data: CardData[],
    options: { connect?: string[] },
    callback: SuccessCallback,
  ) => void;
  hoverCard: (
    boardId: string,
    miroLink: string,
    callback: SuccessCallback,
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
export type QueryFunction<T extends EventMapType> = T;

// This does need to use any, it doesn't work with unknown
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Handler<T extends (...args: any[]) => void, U = void> = (
  ...args: Parameters<T>
) => U;

export interface RetryConfig {
  initialDelay: number; // Initial delay in milliseconds
  maxDelay: number; // Maximum delay in milliseconds
  backoffMultiplier: number; // Multiplier for exponential backoff
  maxRetries: number; // Maximum number of retry attempts
  jitter: boolean; // Add randomization to prevent thundering herd
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  initialDelay: 1000, // 1 second
  maxDelay: 30000, // 30 seconds
  backoffMultiplier: 2,
  maxRetries: 10,
  jitter: true,
};

// Query Proxying Configuration

export interface QueryProxyConfig {
  timeout: number; // Query timeout in milliseconds
  maxRetries: number; // Maximum retry attempts for failed queries
  retryDelay: number; // Delay between retry attempts
  enableCaching: boolean; // Enable query result caching
  cacheTimeout: number; // Cache timeout in milliseconds
}

export const DEFAULT_QUERY_PROXY_CONFIG: QueryProxyConfig = {
  timeout: 10000, // 10 seconds
  maxRetries: 3,
  retryDelay: 1000, // 1 second
  enableCaching: false, // Simplified - use ServerCardStorage instead
  cacheTimeout: 30000, // 30 seconds
};

export type OperationEventType<T extends EventMapType> = {
  boardId: string;
  requestId: string;
  query: keyof T;
  data: Parameters<T[keyof T]>;
};
export type OperationEventCallback<
  T extends EventMapType,
  K extends keyof T = keyof T,
> = (error: AnyError | null, result: Awaited<ReturnType<T[K]>>) => void;

// New type for socket.io callback-based queries
export type CallbackQueryEventType<T extends EventMapType> = {
  boardId: string;
  requestId: string;
  query: keyof T;
  data: Parameters<T[keyof T]>;
};

export interface WorkspaceBoardAssignment {
  workspaceId: string;
  assignedBoards: Set<string>;
  lastActivity: Date;
  permissions: BoardPermissions;
}

export interface BoardPermissions {
  canRead: boolean;
  canWrite: boolean;
  canManage: boolean;
}

export const DEFAULT_BOARD_PERMISSIONS: BoardPermissions = {
  canRead: true,
  canWrite: true,
  canManage: false, // Management requires explicit permission
};

export interface BoardAssignmentConfig {
  autoAssignNewBoards: boolean; // Auto-assign new boards to all workspaces
  requireExplicitAssignment: boolean; // Require explicit assignment for board access
  maxBoardsPerWorkspace: number; // Maximum boards per workspace (0 = unlimited)
  assignmentTimeout: number; // Timeout for assignment requests
}

export const DEFAULT_BOARD_ASSIGNMENT_CONFIG: BoardAssignmentConfig = {
  autoAssignNewBoards: true,
  requireExplicitAssignment: false,
  maxBoardsPerWorkspace: 0, // Unlimited by default
  assignmentTimeout: 5000, // 5 seconds
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

// Workspace connection status
export enum WorkspaceConnectionStatus {
  CONNECTED = "connected",
  DISCONNECTED = "disconnected",
  RECONNECTING = "reconnecting",
  STALE = "stale", // Connected but not responding to health checks
}

export interface WorkspaceInfo {
  id: string; // Unique workspace identifier
  socket: WorkspaceServerSocket;
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
}
