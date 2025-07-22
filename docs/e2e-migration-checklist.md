# E2E Testing Migration Checklist for AppExplorer

## Overview

This checklist helps migrate existing AppExplorer tests from problematic mocking approaches to proper e2e testing that truly simulates user workflows using real VSCode APIs and commands.

## Current Issues in `card-lifecycle.test.ts`

### ❌ Problem 1: Direct Function Imports
```typescript
// WRONG: Bypasses the command system entirely
const { makeCardData } = await import("../../../commands/create-card");
const cardData = await makeCardData(editor, mockClient.getBoardId(), options);
```

**Why this is wrong:** This completely bypasses the VSCode command system, QuickPick interactions, and input validation that real users experience.

### ❌ Problem 2: Manual UI Mocking
```typescript
// WRONG: Manually replaces VSCode UI functions
const originalShowQuickPick = vscode.window.showQuickPick;
vscode.window.showQuickPick = async (items: any[]) => {
  return [mockSelection];
};
```

**Why this is wrong:** This doesn't test the real user experience and can miss UI-related bugs.

### ❌ Problem 3: Console Logging Instead of Debug
```typescript
// WRONG: Uses console.log for debugging
console.log("Step 1: Opening UserProfile.ts file");
console.log("✓ UserProfile.ts opened successfully");
```

**Why this is wrong:** Console logs are not structured, can't be filtered, and pollute test output.

## ✅ Correct Approach for AppExplorer

### ✅ Solution 1: Use Real AppExplorer Commands
```typescript
// CORRECT: Use the actual command system
const cardsPromise = vscode.commands.executeCommand<CardData[]>("app-explorer.createCard");

// Interact with the resulting UI using VSCode commands
await vscode.commands.executeCommand("workbench.action.quickOpenSelectNext");
await vscode.commands.executeCommand("workbench.action.acceptSelectedQuickOpenItem");
```

### ✅ Solution 2: Use E2ETestUtils for AppExplorer Operations
```typescript
// CORRECT: Use AppExplorer-specific utilities
await E2ETestUtils.openFileAtSymbol("src/components/UserProfile.ts", "UserProfile");
const editor = await E2ETestUtils.waitForFileToOpen("UserProfile.ts");
await E2ETestUtils.waitForCursorAtSymbol("UserProfile", editor);

// Navigate using real WebSocket communication
await E2ETestUtils.navigateToCard(testCard);
```

### ✅ Solution 3: Structured Debug Logging
```typescript
// CORRECT: Use debug library with namespaces
import createDebug from "debug";
const debug = createDebug("app-explorer:test:card-lifecycle");

debug("Starting card creation test");
debug("Test data: %O", { card: testCard });
```

## Migration Steps for AppExplorer Tests

### Step 1: Replace Direct Function Calls
- [ ] Remove all `import` statements that bring in command functions like `makeCardData`
- [ ] Replace direct function calls with `vscode.commands.executeCommand("app-explorer.createCard")`
- [ ] Update test assertions to work with command results
- [ ] Use E2ETestUtils methods instead of calling internal functions

### Step 2: Replace UI Mocking with Real Interaction
- [ ] Remove manual `vscode.window.showQuickPick` mocking
- [ ] Remove manual `vscode.window.showInputBox` mocking
- [ ] Add VSCode command-based UI interaction using `workbench.action.*` commands
- [ ] Add proper timing delays for UI appearance (500ms for QuickPick)

### Step 3: Implement Debug Logging
- [ ] Replace `console.log` with `createDebug("app-explorer:test:suite-name")`
- [ ] Create namespaced debuggers for each test suite
- [ ] Add structured logging for test steps with data objects
- [ ] Remove console.log statements that clutter test output

### Step 4: Use E2ETestUtils Properly
- [ ] Use `E2ETestUtils.setupWorkspace()` in suiteSetup
- [ ] Use `E2ETestUtils.setupMockClient()` in setup
- [ ] Use `E2ETestUtils.resetEditorState()` for cleanup
- [ ] Use `E2ETestUtils.teardownTestInfrastructure()` in suiteTeardown
- [ ] Use notification capture methods for error testing

### Step 5: Migrate to Sinon for External Dependencies
- [ ] Replace manual function replacement with Sinon sandboxes
- [ ] Use Sinon only for external dependencies (fetch, WebSocket, etc.)
- [ ] Never mock VSCode UI components with Sinon
- [ ] Ensure proper cleanup in teardown methods

### Step 6: Add Proper Error Handling
- [ ] Add try/catch blocks around command execution
- [ ] Use `E2ETestUtils.startCapturingNotifications()` for error testing
- [ ] Verify error notifications are shown correctly
- [ ] Test edge cases and invalid inputs
- [ ] Ensure cleanup happens even when tests fail

## AppExplorer-Specific Verification Checklist

After migration, verify that your test:

- [ ] **Uses real AppExplorer commands**: All user actions go through `vscode.commands.executeCommand("app-explorer.*")`
- [ ] **Tests real UI**: QuickPick and InputBox interactions use VSCode commands
- [ ] **Uses E2ETestUtils**: File operations, symbol navigation, and card operations use utility methods
- [ ] **Has structured logging**: Uses debug library with `app-explorer:test:*` namespaces
- [ ] **Tests WebSocket communication**: Uses real MockMiroClient connections
- [ ] **Proper mocking**: Uses Sinon for external dependencies only
- [ ] **Clean teardown**: All mocks are restored, MockMiroClient is disconnected, editor state is reset
- [ ] **Error handling**: Tests both success and failure scenarios with notification capture
- [ ] **Timing**: Uses E2ETestUtils waiting methods instead of arbitrary delays
- [ ] **Verification**: Checks actual VSCode state and MockMiroClient storage

## Example Migration

### Before (Problematic)
```typescript
test("Create card", async () => {
  console.log("Starting test");
  
  // Direct function call - WRONG
  const { makeCardData } = await import("../../../commands/create-card");
  
  // Manual mocking - WRONG
  vscode.window.showQuickPick = async () => [mockItem];
  
  const result = await makeCardData(editor, boardId, options);
  assert.ok(result);
});
```

### After (Correct)
```typescript
test("Create card", async () => {
  const debug = createDebug("app-explorer:test:card-lifecycle");
  
  debug("Starting card creation test");
  
  // Use E2ETestUtils for setup - CORRECT
  await E2ETestUtils.openFileAtSymbol("src/components/UserProfile.ts", "UserProfile");
  const editor = await E2ETestUtils.waitForFileToOpen("UserProfile.ts");
  
  // Real command execution - CORRECT
  const cardsPromise = vscode.commands.executeCommand<CardData[]>("app-explorer.createCard");
  
  // Real UI interaction - CORRECT
  await delay(500); // Allow QuickPick to appear
  await vscode.commands.executeCommand("workbench.action.quickOpenSelectNext");
  await vscode.commands.executeCommand("workbench.action.acceptSelectedQuickOpenItem");
  
  // Enter title
  await vscode.commands.executeCommand("type", { text: "My Card" });
  await vscode.commands.executeCommand("workbench.action.acceptSelectedQuickOpenItem");
  
  const [result] = await cardsPromise;
  assert.ok(result);
  debug("Card created successfully: %O", result);
});
```

## Running Migrated Tests

Enable debug output to see detailed test execution:

```bash
DEBUG=app-explorer:test:* npm test
```

Filter debug output by test suite:

```bash
DEBUG=app-explorer:test:card-lifecycle:* npm test
```

## Common AppExplorer Pitfalls to Avoid

1. **Don't mock MockMiroClient**: Use real WebSocket communication through E2ETestUtils
2. **Don't bypass E2ETestUtils**: Use the provided utilities for file operations and navigation
3. **Don't forget server setup**: Always call `E2ETestUtils.setupWorkspace()` in suiteSetup
4. **Don't skip notification capture**: Use `startCapturingNotifications()` for error testing
5. **Don't use arbitrary delays**: Use E2ETestUtils waiting methods with proper timeouts

## Benefits of Proper AppExplorer E2E Testing

- **Real user experience**: Tests actually simulate what users do with AppExplorer
- **Catch integration bugs**: Finds issues with Miro WebSocket communication
- **Better debugging**: Structured logging helps diagnose AppExplorer-specific issues
- **Reliable tests**: Proper MockMiroClient setup prevents test interference
- **Maintainable**: Clear patterns make AppExplorer tests easier to understand and modify
