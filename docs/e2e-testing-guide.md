# End-to-End Testing Guide for AppExplorer VSCode Extension

## Overview

This guide establishes best practices for writing true end-to-end (e2e) tests for the AppExplorer VSCode extension. The goal is to simulate the actual user experience by using real VSCode APIs and commands rather than bypassing the UI layer through mocking or direct function calls.

## Core Principles

### ✅ DO: Use Real VSCode Commands and APIs

**Correct Approach:**

```typescript
// Trigger the actual command that users would invoke
const cardsPromise = vscode.commands.executeCommand<CardData[]>(
  "app-explorer.createCard",
);

// Use VSCode's built-in commands to interact with UI elements
await vscode.commands.executeCommand("workbench.action.quickOpenSelectNext");
await vscode.commands.executeCommand(
  "workbench.action.acceptSelectedQuickOpenItem",
);
```

### ❌ DON'T: Mock UI Interactions or Call Functions Directly

**Incorrect Approach:**

```typescript
// This defeats the purpose of e2e testing
const { makeCardData } = await import("../../../commands/create-card");
const cardData = await makeCardData(editor, boardId, options);

// Manual mocking bypasses the real user experience
vscode.window.showQuickPick = async (items: any[]) => {
  return [mockSelection];
};
```

## Testing Patterns

### 1. Command Execution Pattern

Use `vscode.commands.executeCommand()` to trigger actual extension commands:

```typescript
test("Create card through command palette", async () => {
  // Open a file and position cursor
  await E2ETestUtils.openFileAtSymbol(
    "src/components/UserProfile.ts",
    "UserProfile",
  );

  // Execute the actual command users would run
  const cardsPromise = vscode.commands.executeCommand<CardData[]>(
    "app-explorer.createCard",
  );

  // Interact with the resulting UI using VSCode commands
  await delay(500); // Allow UI to appear
  await vscode.commands.executeCommand("workbench.action.quickOpenSelectNext");
  await vscode.commands.executeCommand(
    "workbench.action.acceptSelectedQuickOpenItem",
  );

  await vscode.commands.executeCommand(
    "workbench.action.acceptSelectedQuickOpenItem",
  );

  // Wait for command completion
  const [createdCard] = await cardsPromise;
  assert.ok(createdCard, "Card should be created");
});
```

### 2. UI Interaction Commands

Use these VSCode built-in commands for UI interaction:

```typescript
// QuickPick navigation
"workbench.action.quickOpenSelectNext"; // Move down in QuickPick
"workbench.action.quickOpenSelectPrevious"; // Move up in QuickPick
"workbench.action.acceptSelectedQuickOpenItem"; // Accept selection

// General navigation
"workbench.action.closeActiveEditor";
"workbench.action.closeAllEditors";
"workbench.action.focusActiveEditorGroup";
```

### 3. AppExplorer Commands

Test AppExplorer-specific commands using real command execution:

```typescript
// Card creation commands
"app-explorer.createCard"; // Create card from current symbol
"app-explorer.attachCard"; // Attach existing card to symbol
"app-explorer.navigate"; // Navigate to card

// Example: Testing card creation
test("Create card command", async () => {
  // Position cursor at symbol first
  await E2ETestUtils.openFileAtSymbol(
    "src/components/UserProfile.ts",
    "UserProfile",
  );

  // Execute the real command
  const cardsPromise = vscode.commands.executeCommand<CardData[]>(
    "app-explorer.createCard",
  );

  // Interact with QuickPick using VSCode commands
  await delay(500); // Allow UI to appear
  await vscode.commands.executeCommand("workbench.action.quickOpenSelectNext");
  await vscode.commands.executeCommand(
    "workbench.action.acceptSelectedQuickOpenItem",
  );

  await vscode.commands.executeCommand(
    "workbench.action.acceptSelectedQuickOpenItem",
  );

  // Verify result
  const [createdCard] = await cardsPromise;
  assert.ok(createdCard, "Card should be created");
  assert.equal(createdCard.title, "My Card Title");
});
```

### 4. Proper Mocking with Sinon

When mocking is necessary, use Sinon instead of manual function replacement:

```typescript
import * as sinon from "sinon";

test("Test with proper mocking", async () => {
  // Create sandbox for clean teardown
  const sandbox = sinon.createSandbox();

  try {
    // Mock external dependencies, not UI interactions
    const mockFetch = sandbox
      .stub(global, "fetch")
      .resolves(new Response("{}"));

    // Run your test
    await vscode.commands.executeCommand("app-explorer.createCard");

    // Verify mocks were called as expected
    assert.ok(mockFetch.calledOnce);
  } finally {
    // Always restore in finally block
    sandbox.restore();
  }
});
```

### 5. Debug Library Usage

Use the `debug` library exclusively in tests and testing tools:

```typescript
import createDebug from "debug";

// Create namespaced debug loggers
const debug = createDebug("app-explorer:test:e2e");

test("Test with debug logging", async () => {
  debug("Starting card creation test");

  await E2ETestUtils.openFileAtSymbol(
    "src/components/UserProfile.ts",
    "UserProfile",
  );

  const cardsPromise = vscode.commands.executeCommand(
    "app-explorer.createCard",
  );

  debug("Test completed successfully");
});
```

Enable debug output in tests:

```bash
DEBUG=app-explorer:test:* npm test
```

## Analysis of Current Implementation Issues

### Issues in `card-lifecycle.test.ts`

1. **Direct Function Import**:

   ```typescript
   // ❌ This bypasses the command system
   const { makeCardData } = await import("../../../commands/create-card");
   ```

2. **Manual UI Mocking**:

   ```typescript
   // ❌ This doesn't test the real user experience
   vscode.window.showQuickPick = async (items: any[]) => {
     /* mock */
   };
   ```

3. **Missing Debug Integration**: Uses `console.log` instead of structured debug logging

### Correct Patterns from `navigation.test.ts`

1. **Real WebSocket Communication**:

   ```typescript
   // ✅ Uses actual WebSocket events
   await E2ETestUtils.navigateTo(testCard);
   ```

2. **Proper Verification**:
   ```typescript
   // ✅ Verifies actual VSCode state
   const editor = await E2ETestUtils.waitForFileToOpen(card.path);
   assert.ok(symbolRange.contains(editor.selection.active));
   ```

## Best Practices

### 1. Test Structure

```typescript
suite("E2E Feature Tests", () => {
  let mockClient: MockMiroClient;
  const debug = createDebug("app-explorer:test:feature");

  setup(async function () {
    this.timeout(15000);
    debug("Setting up test environment");

    await E2ETestUtils.resetEditorState();
    mockClient = await E2ETestUtils.setupMockClient();
  });

  teardown(async function () {
    debug("Tearing down test environment");
    await E2ETestUtils.teardownMockClient();
  });
});
```

### 2. Timing and Synchronization

```typescript
// Use proper waiting instead of arbitrary delays
await E2ETestUtils.waitForFileToOpen("UserProfile.ts");
await E2ETestUtils.waitForCursorAtSymbol("render", editor);

// When delays are necessary, use minimal timing
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
await delay(100); // Minimal delay for UI to appear

await waitFor(
  () => {
    const activeEditor = vscode.window.activeTextEditor;
    assert.ok(
      activeEditor && activeEditor.document.fileName.includes("UserProfile.ts"),
      "UserProfile.ts should be active",
    );
  },
  { timeout: 5000, message: "UserProfile.ts should be active" },
);

// Wait for WebSocket connections and server responses
await waitFor(
  () => {
    assert.ok(mockClient.isConnected, "MockMiroClient should be connected");
  },
  {
    timeout: 10000,
    message: "MockMiroClient should be connected",
  },
);
```

### 3. Error Handling and Cleanup

```typescript
test("Test with proper cleanup", async function () {
  const sandbox = sinon.createSandbox();

  try {
    // Test implementation
  } catch (error) {
    debug("Test failed: %O", error);
    throw error;
  } finally {
    sandbox.restore();
    await E2ETestUtils.resetEditorState();
  }
});
```

## Common Anti-Patterns to Avoid

1. **Bypassing the Command System**: Never import and call command functions directly
2. **Mocking VSCode UI**: Don't mock `showQuickPick`, `showInputBox`, etc.
3. **Arbitrary Delays**: Use proper waiting mechanisms instead of fixed delays
4. **Manual Function Replacement**: Use Sinon instead of manually storing/restoring functions
5. **Console Logging**: Use the debug library for structured logging

## Advanced Testing Scenarios

### Testing Multi-Step Workflows

```typescript
test("Complete card lifecycle workflow", async () => {
  const debug = createDebug("app-explorer:test:lifecycle");

  // Step 1: Open file and navigate to symbol
  debug("Step 1: Opening file");
  await E2ETestUtils.openFileAtSymbol(
    "src/components/UserProfile.ts",
    "UserProfile",
  );
  const editor = await E2ETestUtils.waitForFileToOpen("UserProfile.ts");

  // Step 2: Create card using real command
  debug("Step 2: Creating card");
  const cardsPromise = vscode.commands.executeCommand<CardData[]>(
    "app-explorer.createCard",
  );

  // Step 3: Interact with QuickPick
  debug("Step 3: Selecting symbol");
  await delay(500); // Allow QuickPick to appear
  await vscode.commands.executeCommand("workbench.action.quickOpenSelectNext");
  await vscode.commands.executeCommand(
    "workbench.action.acceptSelectedQuickOpenItem",
  );

  // Step 4: Enter card title
  debug("Step 4: Entering title");
  await vscode.commands.executeCommand(
    "workbench.action.acceptSelectedQuickOpenItem",
  );

  // Step 5: Verify card creation
  debug("Step 5: Verifying creation");
  const [createdCard] = await cardsPromise;
  assert.ok(createdCard, "Card should be created");
  assert.equal(createdCard.title, "UserProfile Component");

  // Step 6: Close editor and navigate back
  debug("Step 6: Testing navigation");
  await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  await E2ETestUtils.navigateTo(createdCard);

  // Step 7: Verify navigation worked
  debug("Step 7: Verifying navigation");
  const reopenedEditor = await E2ETestUtils.waitForFileToOpen("UserProfile.ts");
  await E2ETestUtils.waitForCursorAtSymbol("UserProfile", reopenedEditor);

  debug("Lifecycle test completed successfully");
});
```

### Testing Error Scenarios

```typescript
test("Handle invalid file navigation gracefully", async () => {
  const debug = createDebug("app-explorer:test:error");

  // Start capturing notifications
  E2ETestUtils.startCapturingNotifications();
  E2ETestUtils.clearCapturedNotifications();

  const invalidCard = E2ETestUtils.createInvalidCard("nonexistent-file");

  debug("Testing navigation to invalid file: %s", invalidCard.path);
  await E2ETestUtils.navigateTo(invalidCard);

  // Verify appropriate error notification
  const notifications = E2ETestUtils.getCapturedNotifications();
  const errorNotification = notifications.find(
    (n) => n.type === "warning" && n.message.includes(invalidCard.path),
  );

  assert.ok(
    errorNotification,
    "Expected warning notification for invalid file",
  );
  debug("Error handling verified: %O", errorNotification);
});
```

### Testing Concurrent Operations

```typescript
test("Handle multiple simultaneous card operations", async () => {
  const debug = createDebug("app-explorer:test:concurrent");

  // Open multiple files
  const files = ["src/components/UserProfile.ts", "src/utils/helpers.ts"];
  const editors = await Promise.all(
    files.map((file) => E2ETestUtils.openFileAtSymbol(file, "UserProfile")),
  );

  debug("Opened %d files simultaneously", editors.length);

  // Trigger multiple navigation events
  const cards = TEST_CARDS.slice(0, 3);
  const navigationPromises = cards.map((card) => E2ETestUtils.navigateTo(card));

  // Wait for all navigations to complete
  await Promise.all(navigationPromises);

  // Verify final state
  const activeEditor = vscode.window.activeTextEditor;
  assert.ok(activeEditor, "Should have an active editor");

  debug("Concurrent operations completed successfully");
});
```

## AppExplorer-Specific Testing Patterns

### Using E2ETestUtils for AppExplorer

The `E2ETestUtils` class provides AppExplorer-specific testing utilities:

```typescript
import { E2ETestUtils } from "../../helpers/e2e-test-utils";
import { MockMiroClient } from "../../mocks/mock-miro-client";

suite("E2E Feature Tests", () => {
  let mockClient: MockMiroClient;

  suiteSetup(async function () {
    this.timeout(15000);
    await E2ETestUtils.setupWorkspace();
  });

  setup(async function () {
    this.timeout(15000);
    await E2ETestUtils.resetEditorState();
    mockClient = await E2ETestUtils.setupMockClient();
    E2ETestUtils.startCapturingNotifications();
  });

  teardown(async function () {
    await E2ETestUtils.teardownMockClient();
    await E2ETestUtils.resetEditorState();
  });

  suiteTeardown(async function () {
    await E2ETestUtils.teardownTestInfrastructure();
  });
});
```

### File and Symbol Navigation

Use E2ETestUtils for consistent file and symbol operations:

```typescript
test("Navigate to symbol and create card", async () => {
  // Open file and position cursor at symbol
  await E2ETestUtils.openFileAtSymbol(
    "src/components/UserProfile.ts",
    "UserProfile",
  );

  // Wait for file to open
  const editor = await E2ETestUtils.waitForFileToOpen("UserProfile.ts");

  // Wait for cursor to be positioned correctly
  await E2ETestUtils.waitForCursorAtSymbol("UserProfile", editor);

  // List available symbols for debugging
  const symbols = await E2ETestUtils.listAllSymbolsInDocument(
    "src/components/UserProfile.ts",
  );
  console.log(
    "Available symbols:",
    symbols.map((s) => s.label),
  );
});
```

### Card Navigation Testing

Test card navigation using real WebSocket communication:

```typescript
test("Card navigation workflow", async () => {
  const testCard = TEST_CARDS[0];

  // Navigate to card using real WebSocket events
  await E2ETestUtils.navigateTo(testCard);

  // Verify file opened correctly
  const editor = await E2ETestUtils.waitForFileToOpen(testCard.path);

  // For symbol cards, verify cursor position
  if (isSymbolCard(testCard)) {
    await E2ETestUtils.waitForCursorAtSymbol(testCard.symbol, editor);
  }

  // Verify card is stored correctly
  await E2ETestUtils.verifyCardInStorage(testCard, mockClient);
});
```

### Error Handling and Notifications

Test error scenarios with notification capture:

```typescript
test("Handle invalid file gracefully", async () => {
  // Start capturing notifications
  E2ETestUtils.clearCapturedNotifications();

  const invalidCard = E2ETestUtils.createInvalidCard("nonexistent-file");

  // Attempt navigation (should fail gracefully)
  await E2ETestUtils.navigateTo(invalidCard);

  // Verify appropriate error notification
  const notifications = E2ETestUtils.getCapturedNotifications();
  const errorNotification = notifications.find(
    (n) => n.type === "warning" && n.message.includes(invalidCard.path),
  );

  assert.ok(
    errorNotification,
    "Expected warning notification for invalid file",
  );
});
```

## Testing Utilities Enhancement

### Enhanced Debug Logging

```typescript
// src/test/suite/e2e/navigation.test.ts
import createDebug from "debug";

const debug = createDebug(`app-explorer:test:navigation`);

test("Test with debug logging", async () => {
  debug("Starting test execution");
  debug("Test data: %O", { testCard: TEST_CARDS[0] });

  // Test implementation

  debug("Test completed successfully");
});
```

## Environment Setup

### VSCode Test Configuration

Update `.vscode-test.mjs`:

```javascript
export default defineConfig({
  files: "out/test/**/*.test.js",
  workspaceFolder: "./sample-workspace",
  env: {
    APP_EXPLORER_PORT,
    DEBUG: "app-explorer:test:*", // Enable debug logging
    NODE_ENV: "test",
  },
  mocha: {
    timeout: 30000,
    slow: 10000,
  },
});
```

## Conclusion

True e2e testing requires using the same APIs and workflows that real users experience. By following these patterns, tests will provide confidence that the extension works correctly in real-world scenarios while maintaining the ability to run reliably in automated environments.

### Key Takeaways

1. **Use Real Commands**: Always use `vscode.commands.executeCommand()` instead of direct function calls
2. **Interact with Real UI**: Use VSCode's built-in commands for UI interaction
3. **Structured Logging**: Use the debug library for comprehensive test logging
4. **Proper Mocking**: Use Sinon for external dependencies, never for VSCode UI
5. **Comprehensive Testing**: Cover happy paths, error scenarios, and edge cases
6. **Clean Teardown**: Always restore mocks and reset state properly

Following this guide ensures that e2e tests truly validate the user experience and provide reliable feedback about the extension's functionality.

## Enhanced E2ETestUtils Features

### Sinon-Based Notification Capture

For new tests, use the Sinon-based notification capture:

```typescript
test("Error handling with Sinon", async () => {
  const notificationCapture = E2ETestUtils.createSinonNotificationCapture();

  try {
    // Test code that should trigger notifications
    await E2ETestUtils.navigateTo(invalidCard);

    // Check captured notifications
    const notifications = notificationCapture.getCapturedNotifications();
    const errorNotification = notifications.find((n) => n.type === "warning");
    assert.ok(errorNotification, "Expected warning notification");
  } finally {
    notificationCapture.sandbox.restore();
  }
});
```
