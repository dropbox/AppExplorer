import { AppCard, TagColor } from "@mirohq/websdk-types";

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

export type Queries = {
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

export type RequestEvents = {
  query: <N extends keyof Queries>(data: {
    name: N;
    requestId: string;
    data: Parameters<Queries[N]>;
  }) => void;
};
export type ResponseEvents = {
  cardsInEditor: (data: { path: string; cards: CardData[] }) => void;
  selectedCards: (data: { data: CardData[] }) => void;
  navigateTo: (card: CardData) => void;
  card: (data: { url: string; card: CardData | null }) => void;
  queryResult: <N extends keyof Queries>(data: {
    name: N;
    requestId: string;
    response: Awaited<ReturnType<Queries[N]>>;
  }) => void;
};

export type Handler<T extends (...args: any[]) => void, U = void> = (
  ...args: Parameters<T>
) => U;

// Workspace-Server Communication Protocol Types

export type BoardInfo = {
  id: string;
  name: string;
};

export type ServerCapabilities = {
  supportedFeatures: string[];
  migrationPhase: 1 | 2 | 3 | 4 | 5;
  serverVersion: string;
};

export type WorkspaceEvents =
  // Connection and health
  | { type: "ping"; timestamp: number }
  | { type: "pong"; timestamp: number }
  | { type: "serverHealthCheck"; timestamp: number }
  | { type: "serverHealthResponse"; timestamp: number; status: "healthy" }

  // Workspace registration and capabilities
  | { type: "workspaceRegistration"; workspaceId: string; boardIds: string[] }
  | { type: "serverCapabilities"; capabilities: ServerCapabilities }

  // Board connection events
  | { type: "boardConnected"; boardInfo: BoardInfo }
  | { type: "boardDisconnected"; boardId: string }
  | { type: "connectionStatus"; connectedBoards: string[] }

  // Card data synchronization
  | { type: "cardUpdate"; boardId: string; card: CardData }
  | { type: "cardDelete"; boardId: string; miroLink: string }
  | { type: "navigateToCard"; card: CardData }

  // Query proxying - workspace to server
  | {
      type: "queryRequest";
      requestId: string;
      boardId: string;
      query: keyof Queries;
      data: any[];
      timeout?: number;
    }
  | {
      type: "queryResponse";
      requestId: string;
      result?: any;
      error?: string;
      duration?: number;
    }

  // Query status and health
  | {
      type: "queryTimeout";
      requestId: string;
      query: keyof Queries;
      boardId: string;
    }
  | {
      type: "queryRetry";
      requestId: string;
      attempt: number;
      maxAttempts: number;
    }

  // Workspace board assignment
  | { type: "boardAssignmentRequest"; workspaceId: string; boardIds: string[] }
  | {
      type: "boardAssignmentResponse";
      workspaceId: string;
      assignedBoards: string[];
      deniedBoards: string[];
    }
  | { type: "boardAccessDenied"; boardId: string; reason: string }

  // Error handling
  | { type: "error"; message: string; code?: string };

export type WorkspaceEventHandler = (
  event: WorkspaceEvents,
) => void | Promise<void>;

// Connection Retry Configuration

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

// Query proxy request tracking
export interface QueryProxyRequest {
  requestId: string;
  boardId: string;
  query: keyof Queries;
  data: any[];
  timestamp: number;
  timeout: number;
  workspaceId: string;
  attempt: number;
  maxAttempts: number;
}

// Workspace Board Assignment Configuration

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

// Connection State Management

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "failed";

export interface ConnectionStatus {
  state: ConnectionState;
  lastConnected?: Date;
  retryCount: number;
  error?: string;
}

// Workspace connection status
export enum WorkspaceConnectionStatus {
  CONNECTED = "connected",
  DISCONNECTED = "disconnected",
  RECONNECTING = "reconnecting",
  STALE = "stale", // Connected but not responding to health checks
}

// Workspace Registration and Management

export interface WorkspaceInfo {
  id: string; // Unique workspace identifier
  name?: string; // Optional workspace name
  rootPath?: string; // Workspace root path
  connectedAt: Date; // When workspace connected to server
  lastActivity: Date; // Last activity timestamp
  boardIds: string[]; // Board IDs this workspace is interested in
  connectionStatus: WorkspaceConnectionStatus;
  lastHealthCheck: number; // Timestamp of last successful health check
  reconnectCount: number; // Number of reconnection attempts
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
  serverCapabilities: ServerCapabilities;
  assignedBoards: string[]; // Boards assigned to this workspace
  error?: string;
}

// Server-side workspace management events
export type WorkspaceManagementEvents =
  | { type: "workspaceConnected"; workspace: WorkspaceInfo }
  | { type: "workspaceDisconnected"; workspaceId: string; reason?: string }
  | { type: "workspaceUpdated"; workspace: WorkspaceInfo }
  | { type: "boardAssignment"; workspaceId: string; boardIds: string[] }
  | { type: "workspaceHeartbeat"; workspaceId: string; timestamp: number };

// Workspace filtering and routing
export interface BoardWorkspaceMapping {
  boardId: string;
  assignedWorkspaces: string[]; // Workspace IDs that should receive events for this board
  primaryWorkspace?: string; // Primary workspace for this board (if any)
}

export interface WorkspaceFilter {
  workspaceId: string;
  boardIds: string[];
  eventTypes: string[]; // Which event types this workspace wants to receive
}
