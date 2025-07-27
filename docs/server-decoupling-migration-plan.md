# AppExplorer Server Decoupling Migration Plan

## Overview

This document outlines the incremental migration plan to decouple the MiroServer from VSCode workspaces, enabling multiple workspaces to work with a single server instance while maintaining full functionality throughout the transition.

## Current Architecture

**Problem**: Only one workspace can bind to port 9042, making multi-workspace scenarios impossible.

**Current State**:

- `MiroServer` runs in VSCode workspace process and binds to port 9042
- `CardStorage` (VSCode-backed) holds both card data AND Miro websockets via `connectBoard()`
- `StatusBarManager` directly accesses `CardStorage.getConnectedBoards()` for connection counts
- Commands use `MiroServer.query()` which accesses `CardStorage.getBoardSocket()`

## Target Architecture

**End State**:

- Server process decoupled but still runs in same process
- All Miro websockets held by server's memory-backed `CardStorage`
- Workspace `CardStorage` (VSCode-backed) holds only card data for workspace boards
- Communication via workspace websockets between server and workspaces
- Server routes messages between Miro boards and appropriate workspaces
- Status bar shows connection info received via workspace websocket events

## Feature Flag Management Strategy

### Overview

Since the server always runs locally, we can use a simplified feature flag system that allows toggling between legacy (direct) and new (websocket-based) code paths. This enables gradual migration without complex version coordination or rollback mechanisms.

### Implementation Architecture

#### 1. Configuration

```typescript
interface MigrationFlags {
  // Phase 1: Infrastructure
  enableServerDiscovery: boolean;
  enableWorkspaceWebsockets: boolean;

  // Phase 2: Data Synchronization
  enableDualStorage: boolean;
  enableServerFailover: boolean;

  // Phase 3: Query Proxying
  enableQueryProxying: boolean;

  // Phase 4: Event Routing
  enableServerEventRouting: boolean;

  // Phase 5: Status Bar
  enableWebsocketStatusBar: boolean;

  // Development/Debug
  debugMode: boolean;
}
```

#### 2. Simple Feature Flag Manager

```typescript
class FeatureFlagManager {
  private flags: MigrationFlags;

  constructor(context: vscode.ExtensionContext) {
    this.flags = this.loadConfiguration();
  }

  // Load configuration from VSCode settings
  private loadConfiguration(): MigrationFlags {
    const vscodeConfig = vscode.workspace.getConfiguration(
      "appExplorer.migration",
    );

    return {
      ...this.getDefaults(),
      ...vscodeConfig,
    };
  }

  isEnabled(flag: keyof MigrationFlags): boolean {
    return this.flags[flag];
  }
}
```

### Development Configuration (`settings.json`)

```json
{
  "appExplorer.migration.enableServerDiscovery": true,
  "appExplorer.migration.enableWorkspaceWebsockets": true,
  "appExplorer.migration.debugMode": true
}
```

## Migration Phases

### Phase 1: Infrastructure Setup

**Goal**: Establish workspace websocket infrastructure, server discovery, and server-side storage

**Steps**:

1. **Feature Flag Setup**:

   - Implement simple `FeatureFlagManager` class with VSCode configuration integration
   - Add `enableServerDiscovery` and `enableWorkspaceWebsockets` flags
   - Create development configuration template in `settings.json`

2. **Protocol & Infrastructure**:

   - Create `WorkspaceSocket` protocol types in `EventTypes.ts`
   - Add basic server capability broadcasting

3. **Server Discovery** (gated by `enableServerDiscovery` flag):

   - Use `fetch()` to check if server exists on `http://localhost:9042/`
   - Implement server launch decision logic
   - Add race condition handling for simultaneous server launches

4. **Websocket Infrastructure** (gated by `enableWorkspaceWebsockets` flag):

   - Add workspace websocket server to `MiroServer` (separate from Miro websockets)
   - Create server-side memory-backed `CardStorage` alongside existing VSCode storage
   - Add workspace websocket client connection logic to extension
   - Implement basic connection retry logic

5. **Basic Communication**:
   - Add simple server capability broadcasting to connected workspaces
   - Implement graceful fallback to legacy mode when flags disabled

**Entry Criteria**: Current functionality works normally
**Exit Criteria**:

- Server discovery works (detects existing server or launches new one)
- Workspace connects to server via websocket with retry logic
- Race conditions handled gracefully (port binding conflicts)
- Basic communication works between workspace and server

**Verification**:

- Start first workspace → should launch server
- Start second workspace → should connect as client to existing server
- Close server workspace → remaining workspace should detect and launch new server
- Test simultaneous workspace startup scenarios

**Risks & Mitigation**:

- **Risk**: Websocket connection failures
- **Mitigation**: Implement basic reconnection logic
- **Risk**: Race conditions during simultaneous server launches
- **Mitigation**: OS port binding acts as natural lock - one process wins, others connect as clients

### Phase 2: Dual Storage Synchronization

**Goal**: Maintain synchronized data between server and workspace storage

**Steps**:

1. **Feature Flag Integration**:

   - Enable `enableDualStorage` and `enableServerFailover` flags

2. **Data Synchronization** (gated by `enableDualStorage` flag):

   - Implement board/card sync events over workspace websocket
   - When Miro connects to server, sync board info to workspace
   - When workspace updates cards, sync to server
   - Implement workspace board filtering on server side

3. **Server Health & Failover** (gated by `enableServerFailover` flag):

   - Add basic server health monitoring for workspace clients
   - Implement server failover detection and new server launch

4. **Hybrid Mode Support**:
   - Maintain both direct and websocket data paths based on flags
   - Implement basic data consistency between dual storage systems

**Entry Criteria**: Phase 1 complete, workspace websocket functional with server discovery
**Exit Criteria**:

- Server and workspace maintain synchronized card data
- Workspace clients can detect server failures and trigger failover
- New server can be launched by any remaining workspace

**Verification**:

- Create/update cards in Miro, verify they appear in workspace storage
- Kill server workspace, verify client workspace detects failure and launches new server
- Test data persistence across server failover scenarios

**Risks & Mitigation**:

- **Risk**: Data synchronization race conditions
- **Mitigation**: Use simple event sequencing
- **Risk**: Memory leaks in server storage
- **Mitigation**: Implement cleanup when workspaces disconnect
- **Risk**: Data loss during server failover
- **Mitigation**: Miro board is source of truth - new server re-gathers data when boards are opened
- **Risk**: Split-brain scenarios with multiple servers
- **Mitigation**: OS port binding acts as natural lock mechanism

### Phase 3: Query Operation Proxying

**Goal**: Route MiroServer.query() calls through workspace websockets

**Steps**:

1. **Feature Flag Integration**:

   - Enable `enableQueryProxying` flag

2. **Query Proxying Infrastructure** (gated by `enableQueryProxying` flag):

   - Add query proxy methods to workspace websocket protocol
   - Modify `MiroServer.query()` to route through workspace websocket when flag enabled
   - Implement query timeout and error handling for proxied queries

3. **Hybrid Query Support**:

   - Add fallback to direct socket access when flag disabled or proxy fails
   - Update all command handlers to work with both direct and proxied queries
   - Implement query performance monitoring for rollback triggers

4. **Command Handler Updates**:
   - Update navigation, card creation, attachment, and tagging commands
   - Add feature flag awareness to all query-dependent operations
   - Implement graceful degradation when proxy unavailable

**Entry Criteria**: Phase 2 complete, data synchronization working
**Exit Criteria**: All Miro queries work through workspace websocket proxy
**Verification**: Test all commands (navigate, create card, attach, tag, etc.)

**Risks & Mitigation**:

- **Risk**: Query timeouts or failures
- **Mitigation**: Implement proper timeout handling and fallback mechanisms
- **Risk**: Breaking existing command functionality
- **Mitigation**: Maintain backward compatibility during transition

### Phase 4: Event Routing Migration

**Goal**: Move Miro event handling to server with workspace routing

**Steps**:

1. **Feature Flag Integration**:

   - Enable `enableServerEventRouting` flag
   - Add event routing decision logic based on flag state

2. **Server-Side Event Handling** (gated by `enableServerEventRouting` flag):

   - Move Miro event handlers (`navigateTo`, `updateCard`) to server when flag enabled
   - Implement workspace routing logic (which workspace gets which events)
   - Add workspace registration for board interests

3. **Client-Side Event Updates**:

   - Update extension event handlers to receive events via workspace websocket when flag enabled
   - Maintain direct event handling as fallback when flag disabled
   - Handle `navigateTo` broadcasting to all workspaces when board unknown

4. **Hybrid Event Support**:
   - Support both direct and routed event handling based on flag state
   - Implement event deduplication to prevent double-handling during transition
   - Add event routing performance monitoring

**Entry Criteria**: Phase 3 complete, query proxying functional
**Exit Criteria**: All Miro events routed through server to appropriate workspaces
**Verification**: Test card navigation, updates, and multi-board scenarios

**Risks & Mitigation**:

- **Risk**: Events routed to wrong workspace
- **Mitigation**: Implement proper workspace-board association tracking

### Phase 5: Status Bar Decoupling

**Goal**: Update status bar to use websocket events instead of direct CardStorage access

**Steps**:

1. **Feature Flag Integration**:

   - Enable `enableWebsocketStatusBar` flag
   - Add status bar data source decision logic based on flag state

2. **Websocket Status Updates** (gated by `enableWebsocketStatusBar` flag):

   - Add connection status events to workspace websocket protocol
   - Modify server to broadcast connection count changes when flag enabled
   - Update `StatusBarManager` to listen for websocket events when flag enabled

3. **Hybrid Status Bar Support**:

   - Maintain direct `CardStorage` access as fallback when flag disabled
   - Add fallback display during websocket disconnections
   - Implement workspace-specific board filtering for status display

4. **Status Bar Reliability**:
   - Add status bar update performance monitoring
   - Implement status caching to prevent UI flickering during websocket issues
   - Add manual refresh capability for status bar information

**Entry Criteria**: Phase 4 complete, event routing functional
**Exit Criteria**: Status bar shows correct info from websocket events
**Verification**: Connect/disconnect Miro boards, verify status bar updates correctly

**Risks & Mitigation**:

- **Risk**: Status bar showing incorrect counts
- **Mitigation**: Implement proper event handling and state synchronization
- **Risk**: UI unresponsive during websocket issues
- **Mitigation**: Add timeout handling and fallback displays

### Phase 6: Final Cleanup

**Goal**: Remove Miro socket handling from workspace CardStorage

**Steps**:

1. **Pre-Cleanup Validation**:

   - Verify all feature flags are enabled and stable
   - Confirm all functionality works through websocket paths
   - Run comprehensive integration tests with all flags enabled

2. **Legacy Code Removal**:

   - Remove `connectBoard()`, `getBoardSocket()`, `getConnectedBoards()` from workspace CardStorage
   - Remove Miro socket storage from workspace CardStorage
   - Update CardStorage to be pure data storage (no socket management)

3. **Feature Flag Cleanup**:

   - Remove all migration-related feature flags from codebase
   - Remove fallback code paths from previous phases
   - Update configuration templates to remove migration flags

4. **Final Integration Testing**:
   - Add comprehensive integration tests for the new architecture
   - Test multi-workspace scenarios extensively
   - Verify performance meets or exceeds original implementation

**Entry Criteria**: Phase 5 complete, status bar working via websockets
**Exit Criteria**: Complete separation achieved, all functionality working
**Verification**: Full end-to-end testing with multiple workspaces and boards

**Risks & Mitigation**:

- **Risk**: Breaking functionality during cleanup
- **Mitigation**: Thorough testing before removing fallback code
- **Risk**: Data loss during migration
- **Mitigation**: Maintain data integrity checks throughout cleanup

## Technical Implementation Details

### Server Discovery & Failover Architecture

```typescript
interface ServerDiscovery {
  checkServerHealth(): Promise<boolean>;
  launchServer(): Promise<MiroServer>;
  connectAsClient(): Promise<WorkspaceClient>;
  handleServerFailure(): Promise<void>;
}

interface ServerHealthCheck {
  endpoint: "/";
  timeout: 5000; // 5 seconds
  retryInterval: 10000; // 10 seconds
  maxRetries: 3;
}
```

### Workspace Socket Protocol

```typescript
type WorkspaceEvents =
  | { type: "boardConnected"; boardInfo: BoardInfo }
  | { type: "boardDisconnected"; boardId: string }
  | { type: "cardUpdate"; boardId: string; card: CardData }
  | { type: "navigateTo"; card: CardData }
  | { type: "connectionStatus"; connectedBoards: string[] }
  | {
      type: "queryRequest";
      requestId: string;
      boardId: string;
      query: string;
      data: any;
    }
  | { type: "queryResponse"; requestId: string; result: any; error?: string }
  | { type: "serverHealthCheck"; timestamp: number }
  | { type: "serverHealthResponse"; timestamp: number; status: "healthy" }
  | { type: "workspaceRegistration"; workspaceId: string; boardIds: string[] };
```

### Connection Retry Strategy

```typescript
interface RetryConfig {
  initialDelay: 1000; // 1 second
  maxDelay: 30000; // 30 seconds
  backoffMultiplier: 2;
  maxRetries: 10;
  jitter: true; // Add randomization to prevent thundering herd
}
```

### Server Launch Decision Flow

```typescript
async function initializeExtension(context: vscode.ExtensionContext) {
  const serverDiscovery = new ServerDiscovery();

  try {
    // Step 1: Check if server exists
    const serverExists = await serverDiscovery.checkServerHealth();

    if (serverExists) {
      // Step 2a: Connect as workspace client
      const client = await serverDiscovery.connectAsClient();
      return new WorkspaceMode(context, client);
    } else {
      // Step 2b: Launch server in this workspace
      const server = await serverDiscovery.launchServer();
      return new ServerMode(context, server);
    }
  } catch (portBindingError) {
    // Step 3: Handle race condition - another workspace won the port
    const client = await serverDiscovery.connectAsClient();
    return new WorkspaceMode(context, client);
  }
}
```

### Hybrid Mode Implementation

#### Simple Code Path Management

```typescript
class HybridModeManager {
  constructor(private flagManager: FeatureFlagManager) {}

  // Determine which code path to use for queries
  shouldUseWebsocketQuery(): boolean {
    return (
      this.flagManager.isEnabled("enableQueryProxying") &&
      this.flagManager.isEnabled("enableWorkspaceWebsockets")
    );
  }

  // Determine which code path to use for events
  shouldUseWebsocketEvents(): boolean {
    return (
      this.flagManager.isEnabled("enableServerEventRouting") &&
      this.flagManager.isEnabled("enableWorkspaceWebsockets")
    );
  }

  // Simple fallback strategy
  async executeWithFallback<T>(
    websocketOperation: () => Promise<T>,
    directOperation: () => Promise<T>,
  ): Promise<T> {
    if (this.shouldUseWebsocket()) {
      try {
        return await websocketOperation();
      } catch (error) {
        return await directOperation();
      }
    }
    return await directOperation();
  }
}
```

#### Data Consistency Strategy

- **Single Source of Truth**: Miro board remains authoritative for card data
- **Workspace Storage**: Maintains local cache with VSCode persistence
- **Server Storage**: Maintains memory cache for routing and performance
- **Synchronization**: Simple event-driven updates ensure consistency

### Verification Checklist (After Each Phase)

**Basic Functionality:**

- [ ] Extension activates successfully
- [ ] Status bar shows correct information
- [ ] Can connect to Miro boards
- [ ] Can create new cards from VSCode
- [ ] Can navigate from Miro to VSCode
- [ ] Can attach existing cards
- [ ] Can tag cards
- [ ] Can rename boards
- [ ] Multiple boards work correctly
- [ ] Workspace board filtering works
- [ ] No memory leaks or resource issues

**Server Discovery & Failover (Phase 1+):**

- [ ] First workspace launches server successfully
- [ ] Second workspace connects as client to existing server
- [ ] Health check endpoint responds correctly
- [ ] Race condition handling works (simultaneous launches)
- [ ] Server workspace closure triggers failover in client workspaces
- [ ] New server launches successfully after failover
- [ ] Connection retry logic works with exponential backoff

**Feature Flag Management (All Phases):**

- [ ] Feature flags can be toggled via VSCode settings
- [ ] Graceful degradation occurs when flags are disabled

## Success Criteria

- Multiple VSCode workspaces can work with the same server
- All existing functionality preserved
- Status bar correctly shows connection information
- Performance is maintained or improved
- No data loss during migration
- Clean separation between server and workspace concerns
