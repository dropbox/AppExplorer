# AppExplorer Multi-Workspace Testing Guide

## Overview

This guide provides step-by-step instructions for testing the newly activated multi-workspace functionality in AppExplorer. The system now supports true multi-workspace operation where:

- **First VSCode instance** launches MiroServer embedded in the process, then operates as a client
- **ALL VSCode instances** operate in CLIENT mode using WorkspaceWebsocketClient
- **Consistent architecture** - every workspace uses WorkspaceCardStorageProxy for uniform behavior
- **Multiple workspaces** can open the same Miro boards and see synchronized data
- **Board assignments and event routing** work across multiple workspace instances

## Prerequisites

1. **Build the extension**: Run `npm run compile` to ensure latest changes are built
2. **Feature flags enabled**: Verify `.vscode/settings.json` has multi-workspace features enabled
3. **Multiple workspace folders**: Prepare 2-3 different workspace folders for testing

## Test Scenarios

### Test 1: Sequential Workspace Launch

**Expected Behavior**: First instance launches server then operates as client, subsequent instances operate as clients.

**Steps**:

1. **Launch Instance 1**:

   ```bash
   code workspace1/
   ```

   - Should see: "AppExplorer - Server started. Open a Miro board to connect."
   - Check logs: Should show "Launched MiroServer, now switching to client mode"
   - Should show: "Successfully connected to launched server as client"

2. **Launch Instance 2**:

   ```bash
   code workspace2/
   ```

   - Should see: No server startup message (discovers existing server)
   - Check logs: Should show "Running in client mode, connecting to server"
   - Should show: "Workspace registration successful"

3. **Launch Instance 3**:
   ```bash
   code workspace3/
   ```
   - Should see: No server startup message (discovers existing server)
   - Check logs: Should show "Running in client mode, connecting to server"
   - Should show: "Workspace registration successful"

**Validation**:

- Only Instance 1 should show server startup message
- ALL instances should operate in client mode with WorkspaceCardStorageProxy
- All instances should be functional for viewing cards
- Consistent behavior across all workspace instances

### Test 2: Board Assignment and Event Routing

**Expected Behavior**: Board assignments work across workspaces, events are routed correctly.

**Steps**:

1. **Instance 1**: Open a Miro board (Board A)

   - Should auto-assign Board A to workspace1
   - Check server logs: "Board assigned to workspace"

2. **Instance 2**: Open the same Miro board (Board A)

   - Should auto-assign Board A to workspace2
   - Both instances should see the same cards

3. **Instance 3**: Open a different Miro board (Board B)

   - Should auto-assign Board B to workspace3
   - Should not see Board A cards

4. **Test Event Broadcasting**:
   - In Instance 1: Create/modify a card in Board A
   - Instance 2 should see the update (same board)
   - Instance 3 should NOT see the update (different board)

**Validation**:

- Board assignments are tracked per workspace
- Events are only sent to workspaces assigned to the relevant board
- Cross-workspace synchronization works for shared boards

### Test 3: Server Failover

**Expected Behavior**: When server instance closes, clients detect failure and can reconnect to new server.

**Steps**:

1. **Setup**: Have Instance 1 (server) + Instance 2 (client) running
2. **Close Instance 1**: Terminate the server instance
3. **Check Instance 2**: Should detect server disconnection
4. **Launch Instance 3**: Should become new server
5. **Instance 2**: Should attempt to reconnect to new server

**Validation**:

- Client instances detect server failure
- New instances can become server when needed
- Reconnection logic works properly

### Test 4: Workspace Connection Monitoring

**Expected Behavior**: Health checks work, stale connections are cleaned up.

**Steps**:

1. **Setup**: Multiple client instances connected
2. **Simulate Network Issue**: Temporarily block network for one client
3. **Check Server Logs**: Should mark workspace as STALE after timeout
4. **Restore Network**: Client should reconnect and restore status

**Validation**:

- Health check system detects stale connections
- Automatic cleanup of disconnected workspaces
- Reconnection restores workspace assignments

## Debugging

### Check Extension Logs

**VSCode Output Panel**:

1. Open Command Palette (`Ctrl+Shift+P`)
2. Run "Developer: Show Logs..."
3. Select "Extension Host"
4. Look for AppExplorer log entries

**Key Log Messages**:

- `Launched MiroServer, now switching to client mode` - Instance launched server
- `Running in client mode, connecting to server` - Instance discovered existing server
- `Successfully connected to launched server as client` - Server-hosting instance connected as client
- `Workspace registration successful` - Client registered with server
- `Board assigned to workspace` - Board assignment completed
- `Event broadcast to board workspaces` - Event routing working

### Check Server Status

**Server Instance (Instance 1)**:

- Should show "Server started successfully" message
- Should log workspace registrations
- Should log board assignments
- Should log event broadcasts

**Client Instances (Instance 2+)**:

- Should show "Workspace registration successful"
- Should log query proxy operations
- Should receive board update events

### Common Issues

**Port Already in Use**:

- If you see "Port 3000 is already in use", another server is running
- Close all VSCode instances and restart
- Check for background processes using port 3000

**Client Connection Failed**:

- Ensure server instance is running first
- Check feature flags are enabled
- Verify network connectivity (localhost:3000)

**Board Assignment Not Working**:

- Check that `enableBoardAssignment` feature flag is enabled
- Verify workspace registration completed successfully
- Check server logs for assignment events

## Expected Results

After successful testing, you should observe:

1. **✅ True Multi-Workspace Operation**: Multiple VSCode instances working together
2. **✅ Server Discovery**: Automatic server/client mode selection
3. **✅ Workspace Registration**: Clients register with central server
4. **✅ Board Assignment**: Boards assigned to specific workspaces
5. **✅ Event Routing**: Updates broadcast only to relevant workspaces
6. **✅ Connection Monitoring**: Health checks and automatic cleanup
7. **✅ Synchronized Data**: Shared boards show same data across workspaces

## Next Steps

Once multi-workspace functionality is validated:

1. **Command Proxying**: Implement full command support in client mode
2. **Performance Optimization**: Optimize event routing and caching
3. **Error Handling**: Improve error handling and recovery
4. **User Experience**: Add status indicators for multi-workspace mode
5. **Documentation**: Update user documentation with multi-workspace features

## Troubleshooting

If tests fail, check:

- Feature flags are properly enabled
- Build completed successfully
- No TypeScript compilation errors
- Server discovery system is working
- Workspace websocket connections are established
