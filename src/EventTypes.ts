import { AppCard, TagColor } from "@mirohq/websdk-types";
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

// Operations callable on Miro boards from workspaces (via server)
// Data flow: Workspace → Server → Miro Board
export type WorkspaceToMiroOperations = {
  getIdToken: () => Promise<string>;
  setBoardName: (name: string) => Promise<void>;
  getBoardInfo: () => Promise<{ name: string; boardId: string }>;
  tags: () => Promise<AppExplorerTag[]>;
  attachCard: (data: CardData) => Promise<void>;
  tagCards: (data: {
    miroLink: string[];
    tag:
      | string
      | {
          color: TagColor;
          title: string;
        };
  }) => Promise<void>;
  selectCard: (miroLink: string) => Promise<boolean>;
  cardStatus: (data: {
    miroLink: string;
    status: "connected" | "disconnected";
    codeLink: string | null;
  }) => Promise<void>;
  cards: () => Promise<CardData[]>;
  selected: () => Promise<CardData[]>;
  newCards: (
    data: CardData[],
    options?: { connect?: string[] },
  ) => Promise<void>;
  hoverCard: (miroLink: string) => Promise<void>;
};

export type ServerToWorkspaceEvents = {
  registrationComplete: (response: WorkspaceRegistrationResponse) => void;
};

// Event notifications sent from server to workspace clients
// Data flow: Server → Workspace (routed through server)
export type MiroToWorkspaceEvents =
  QueryResultFunction<WorkspaceToMiroOperations> & {
    // Core workspace events
    cardsInEditor: (data: { path: string; cards: CardData[] }) => void;
    selectedCards: (data: { data: CardData[] }) => void;
    navigateTo: (card: CardData) => void;
    card: (data: { url: string; card: CardData | null }) => void;

    // Board connection events
    connectionStatus: (data: {
      type: "connectionStatus";
      connectedBoards: string[];
    }) => void;

    // Health and registration events
    healthCheck: (data: { type: "healthCheck"; timestamp: number }) => void;
  };

// Operations callable on server from workspaces
// Data flow: Workspace → Server
export type WorkspaceToServerOperations = {
  workspaceRegistration: (
    request: WorkspaceRegistrationRequest,
  ) => Promise<WorkspaceRegistrationResponse>;
};

export type EventMapType = {
  // This does need to use any, it doesn't work with unknown
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [K: string]: (...args: any[]) => any;
};
export type QueryFunction<T extends EventMapType> = {
  query: <N extends keyof T>(
    data: Extract<OperationEventType<T>, { query: N }>,
  ) => void;
};
export type QueryResultFunction<T extends EventMapType> = {
  queryResult: <N extends keyof T>(
    data:
      | {
          name: N;
          requestId: string;
          response: Awaited<ReturnType<T[N]>>;
          error?: never;
        }
      | {
          name: N;
          requestId: string;
          error: string;
          response?: never;
        },
  ) => void;
};

// This does need to use any, it doesn't work with unknown
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Handler<T extends (...args: any[]) => void, U = void> = (
  ...args: Parameters<T>
) => U;

// Workspace-Server Communication Protocol Types

export type BoardInfo = {
  id: string;
  name: string;
};

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
  resolve: (response: Awaited<ReturnType<T[keyof T]>>) => void;
  reject: (error: any) => void;
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
  boardIds: string[];
  capabilities: string[]; // What features this workspace supports
}

export interface WorkspaceRegistrationResponse {
  success: boolean;
  workspaceId: string;
  assignedBoards: string[]; // Boards assigned to this workspace
  error?: string;
}
