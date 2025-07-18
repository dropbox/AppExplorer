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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  // Query proxying
  | {
      type: "queryRequest";
      requestId: string;
      boardId: string;
      query: keyof Queries;
      data: any;
    }
  | { type: "queryResponse"; requestId: string; result: any; error?: string }

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

// Workspace Registration and Management

export interface WorkspaceInfo {
  id: string; // Unique workspace identifier
  name?: string; // Optional workspace name
  rootPath?: string; // Workspace root path
  connectedAt: Date; // When workspace connected to server
  lastActivity: Date; // Last activity timestamp
  boardIds: string[]; // Board IDs this workspace is interested in
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
