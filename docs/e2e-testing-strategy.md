# AppExplorer End-to-End Testing Strategy

## Overview

This document outlines a comprehensive, incremental approach to implementing reliable end-to-end (E2E) testing for AppExplorer's integration with Miro. The strategy focuses on simulating Miro interactions through a MockMiroClient that connects to the local AppExplorer server, presenting itself as a real Miro board with predefined test cards.

## Current State Analysis

### Existing Architecture

- **VSCode Extension**: Main extension running in workspace process
- **MiroServer**: Local server on port 9042 handling WebSocket connections
- **Card Storage**: VSCode-backed storage linking Miro cards to code symbols
- **Navigation System**: Responds to `navigateToCard` events from Miro
- **Unit Tests**: Basic test coverage using Mocha and @vscode/test-cli

### Key Integration Points

- WebSocket events: `navigateToCard`, `updateCard`, `connect`/`disconnect`
- Card data structure: `{ path, symbol, miroLink, codeLink, boardId }`
- LocationFinder for symbol resolution and navigation
- Command system for card creation, attachment, and navigation

## Testing Strategy Overview

### Core Principles

1. **No Manual Browser Interaction**: All tests must be fully automated
2. **MockMiroClient Environment**: Use MockMiroClient to simulate real Miro board connections to the local AppExplorer server
3. **Incremental Development**: Each phase builds on previous milestones
4. **Reliable Verification**: Clear checkpoints ensure each step works correctly
5. **Future-Proof Design**: Support evolving architecture (workspace websockets, server discovery)
6. **Debug-Friendly**: Manual debug command for developers to test interactions in real-time

### Test Scope

- **In Scope**: WebSocket communication, card navigation, file opening, symbol positioning, error handling, MockMiroClient server connections
- **Out of Scope**: Real Miro board interactions, browser automation, network-dependent operations

## Phase 1: Mock Infrastructure Setup

### Objectives

- Create reliable MockMiroClient environment that connects to local AppExplorer server
- Establish test workspace with realistic code examples
- Implement basic event verification framework
- Add debug command for manual testing and development

### Tasks

#### 1.1 MockMiroClient Implementation

**Duration**: 3-4 days

Create `src/test/mocks/mock-miro-client.ts`:

```typescript
export class MockMiroClient {
  private socket: Socket;
  private boardId: string;
  private boardName: string;
  private testCards: CardData[];
  private cardStorage: CardStorage; // In-memory implementation

  constructor(serverUrl: string = "http://localhost:9042") {
    this.boardId = "mock-board-test-123";
    this.boardName = "Mock Test Board";
    this.cardStorage = createInMemoryCardStorage();
  }

  // Connect to local AppExplorer server (replaces src/miro.ts functionality)
  async connect(): Promise<void>;

  // Load predefined test card fixtures
  loadTestCards(cards: CardData[]): void;

  // Simulate Miro board events
  simulateCardOpen(cardId: string): void;
  simulateCardSelection(cardIds: string[]): void;
  simulateCardUpdate(card: CardData): void;

  // Handle commands from VSCode with user feedback
  onCardStatusUpdate(callback: (data: any) => void): void;
  onCardSelection(callback: (data: any) => void): void;
}
```

**MockMiroClient Architecture Details**:

- **Server Connection**: Connects to `http://localhost:9042` via WebSocket (same as real Miro boards)
- **Board Identity**: Presents itself with fake board ID `mock-board-test-123` and name `Mock Test Board`
- **Card Storage**: Uses in-memory CardStorage implementation for test isolation
- **Event Simulation**: Replaces `src/miro.ts` functionality by simulating board events
- **Command Handling**: Receives and responds to VSCode commands like real Miro boards
- **Logging**: Comprehensive logging of all interactions for debugging

**Verification Checkpoint**: MockMiroClient can connect to local server and VSCode extension recognizes it as a valid board connection.

#### 1.2 Enhanced Test Workspace

**Duration**: 1-2 days

Expand `sample-workspace/` with realistic project structure:

```
sample-workspace/
├── src/
│   ├── components/
│   │   ├── UserProfile.ts
│   │   └── Dashboard.ts
│   ├── services/
│   │   ├── ApiService.ts
│   │   └── AuthService.ts
│   ├── utils/
│   │   └── helpers.ts
│   └── types/
│       └── interfaces.ts
├── tests/
│   └── unit/
└── package.json
```

**Verification Checkpoint**: LocationFinder can resolve symbols across all test files.

#### 1.3 Test Data Management

**Duration**: 1 day

Create `src/test/fixtures/card-data.ts`:

```typescript
export const TEST_CARDS: CardData[] = [
  {
    boardId: "mock-board-test-123",
    type: "symbol",
    title: "UserProfile.render",
    path: "src/components/UserProfile.ts",
    symbol: "render",
    miroLink: "https://miro.com/app/board/mock-board-test-123/card1",
    codeLink:
      "https://github.com/test/repo/blob/main/src/components/UserProfile.ts#L25",
    status: "connected",
  },
  {
    boardId: "mock-board-test-123",
    type: "symbol",
    title: "ApiService.fetchData",
    path: "src/services/ApiService.ts",
    symbol: "fetchData",
    miroLink: "https://miro.com/app/board/mock-board-test-123/card2",
    codeLink:
      "https://github.com/test/repo/blob/main/src/services/ApiService.ts#L15",
    status: "connected",
  },
  {
    boardId: "mock-board-test-123",
    type: "symbol",
    title: "TestClass.testMethod",
    path: "example.ts",
    symbol: "testMethod",
    miroLink: "https://miro.com/app/board/mock-board-test-123/card3",
    codeLink: "https://github.com/test/repo/blob/main/example.ts#L3",
    status: "connected",
  },
  // ... more test cards mapping to actual symbols in sample-workspace
];
```

**Test Data Integration Requirements**:

- All card paths must reference actual files in the expanded `sample-workspace/` structure
- All symbols must exist and be discoverable by LocationFinder
- All codeLinks must be valid GitHub URLs (can be mock URLs for testing)
- Board IDs must match the MockMiroClient's board ID for consistency

**Verification Checkpoint**: Test data loads correctly, matches expected schema, and all referenced symbols exist in the test workspace.

#### 1.4 Debug Command Implementation

**Duration**: 1-2 days

Add VSCode command `src/commands/debug-mock-client.ts`:

```typescript
export const makeDebugMockClientHandler = (
  context: HandlerContext,
  extensionContext: vscode.ExtensionContext,
) => {
  return async () => {
    const mockClient = new MockMiroClient();

    // Load test card fixtures
    mockClient.loadTestCards(TEST_CARDS);

    // Connect to local server
    await mockClient.connect();

    // Register manual debug commands
    registerMockMiroDebugCommands(extensionContext, mockClient);

    // Set up user feedback handlers
    mockClient.onCardStatusUpdate((data) => {
      vscode.window.showInformationMessage(
        `MockMiroClient: Received card status update - ${JSON.stringify(data)}`,
      );
    });

    mockClient.onCardSelection((data) => {
      vscode.window.showInformationMessage(
        `MockMiroClient: Received card selection - ${data.length} cards`,
      );
    });

    vscode.window.showInformationMessage(
      `MockMiroClient connected as board "${mockClient.boardName}" with ${TEST_CARDS.length} test cards. Use "MockMiro: Show Card List" command to simulate events.`,
    );
  };
};
```

Register command in `src/extension.ts`:

```typescript
vscode.commands.registerCommand(
  "app-explorer.launchMockMiroClient",
  makeDebugMockClientHandler(handlerContext, context),
);
```

Add command to `package.json`:

```json
{
  "command": "app-explorer.launchMockMiroClient",
  "title": "AppExplorer: Launch Mock Miro Client",
  "category": "AppExplorer"
}
```

**MockMiroClient User Feedback Features**:

- **Connection Status**: Shows notification when connected/disconnected from server
- **Command Logging**: Logs all received VSCode commands with detailed parameters
- **Operation Confirmation**: Displays what operation the mock client is performing
- **Card State Updates**: Shows when cards are updated, selected, or navigated to
- **Error Reporting**: Clear error messages when operations fail

#### 1.5 Manual Debug Commands

**Duration**: 2-3 days

When MockMiroClient launches, it should register additional VSCode commands for manual testing:

**Command Registration** in `src/commands/debug-mock-client.ts`:

```typescript
export const registerMockMiroDebugCommands = (
  context: vscode.ExtensionContext,
  mockClient: MockMiroClient,
) => {
  const commands = [
    vscode.commands.registerCommand(
      "app-explorer.mockMiro.showCardList",
      async () => {
        const cards = mockClient.getTestCards();
        const quickPickItems = cards.map((card) => ({
          label: card.title,
          description: `${card.path} → ${card.symbol}`,
          detail: `Status: ${card.status} | Board: ${card.boardId}`,
          card: card,
        }));

        const selected = await vscode.window.showQuickPick(quickPickItems, {
          placeHolder: "Select a card to simulate opening",
          matchOnDescription: true,
          matchOnDetail: true,
        });

        if (selected) {
          await vscode.commands.executeCommand(
            "app-explorer.mockMiro.simulateCardOpen",
            selected.card,
          );
        }
      },
    ),

    vscode.commands.registerCommand(
      "app-explorer.mockMiro.simulateCardOpen",
      async (card?: CardData) => {
        if (!card) {
          vscode.window.showErrorMessage("No card provided for simulation");
          return;
        }

        // Send WebSocket event to local server (same format as real Miro)
        mockClient.sendNavigateToEvent(card);

        vscode.window.showInformationMessage(
          `MockMiroClient: Simulated opening card "${card.title}" → ${card.path}:${card.symbol}`,
        );

        console.log("MockMiroClient: Sent navigateTo event", {
          cardTitle: card.title,
          path: card.path,
          symbol: card.symbol,
          miroLink: card.miroLink,
        });
      },
    ),

    vscode.commands.registerCommand(
      "app-explorer.mockMiro.simulateCardSelection",
      async () => {
        const cards = mockClient.getTestCards();
        const quickPickItems = cards.map((card) => ({
          label: card.title,
          description: `${card.path} → ${card.symbol}`,
          picked: false,
          card: card,
        }));

        const selected = await vscode.window.showQuickPick(quickPickItems, {
          placeHolder: "Select cards to simulate selection (multi-select)",
          canPickMany: true,
          matchOnDescription: true,
        });

        if (selected && selected.length > 0) {
          const selectedCards = selected.map((item) => item.card);

          // Send selection event to local server
          mockClient.sendSelectionUpdateEvent(selectedCards);

          vscode.window.showInformationMessage(
            `MockMiroClient: Simulated selecting ${selectedCards.length} cards`,
          );

          console.log("MockMiroClient: Sent selection update event", {
            cardCount: selectedCards.length,
            cards: selectedCards.map((c) => ({ title: c.title, path: c.path })),
          });
        }
      },
    ),
  ];

  context.subscriptions.push(...commands);
};
```

**Enhanced MockMiroClient** with WebSocket event sending:

```typescript
export class MockMiroClient {
  // ... existing properties

  // Send events using same protocol as real Miro boards
  sendNavigateToEvent(card: CardData): void {
    if (!this.socket?.connected) {
      vscode.window.showErrorMessage("MockMiroClient: Not connected to server");
      return;
    }

    // Send navigateTo event (same as src/miro.ts line 439)
    this.socket.emit("navigateTo", card);

    console.log("MockMiroClient: Sent navigateTo event to server", {
      event: "navigateTo",
      card: {
        title: card.title,
        path: card.path,
        symbol: card.symbol,
        miroLink: card.miroLink,
      },
    });
  }

  sendSelectionUpdateEvent(cards: CardData[]): void {
    if (!this.socket?.connected) {
      vscode.window.showErrorMessage("MockMiroClient: Not connected to server");
      return;
    }

    // Send card events for each selected card (same as src/miro.ts line 488)
    cards.forEach((card) => {
      this.socket.emit("card", {
        url: card.miroLink!,
        card: card,
      });
    });

    console.log("MockMiroClient: Sent card selection events to server", {
      event: "card",
      cardCount: cards.length,
    });
  }

  getTestCards(): CardData[] {
    return this.testCards;
  }
}
```

**Command Registration** in package.json:

```json
{
  "commands": [
    {
      "command": "app-explorer.mockMiro.showCardList",
      "title": "MockMiro: Show Card List",
      "category": "AppExplorer"
    },
    {
      "command": "app-explorer.mockMiro.simulateCardOpen",
      "title": "MockMiro: Simulate Card Open",
      "category": "AppExplorer"
    },
    {
      "command": "app-explorer.mockMiro.simulateCardSelection",
      "title": "MockMiro: Simulate Card Selection",
      "category": "AppExplorer"
    }
  ]
}
```

**Developer Workflow**:

1. **Launch MockMiroClient**: Run "AppExplorer: Launch Mock Miro Client" command
2. **View Available Cards**: Run "MockMiro: Show Card List" to see all test cards in QuickPick
3. **Simulate Navigation**: Select a card from the list to trigger navigation event
4. **Test Multi-Selection**: Use "MockMiro: Simulate Card Selection" for multi-card scenarios
5. **Observe Results**: Watch VSCode open files, position cursor, and update status bar
6. **Debug Issues**: Check console logs and notifications for detailed event information

**WebSocket Protocol Compliance**:

- Uses same event names as real Miro boards (`navigateTo`, `card`)
- Sends identical data structures to ensure VSCode responds correctly
- Maintains connection state and error handling like real boards
- Logs all events for debugging and verification

**Verification Checkpoint**: Debug command successfully launches MockMiroClient and provides clear user feedback. Manual debug commands allow developers to trigger simulated Miro events and see real-time VSCode responses.

### Phase 1 Success Criteria

- [ ] MockMiroClient connects to local server successfully
- [ ] VSCode extension recognizes MockMiroClient as valid board connection
- [ ] Test workspace provides comprehensive symbol coverage
- [ ] Test data fixtures are well-structured and maintainable
- [ ] Debug command works and provides clear feedback
- [ ] Manual debug commands (showCardList, simulateCardOpen, simulateCardSelection) are registered and functional
- [ ] QuickPick interface displays test cards with proper formatting
- [ ] WebSocket events are sent using the same protocol as real Miro boards
- [ ] VSCode responds to simulated events exactly as it would to real Miro interactions

## Phase 2: Basic Navigation Testing

### Objectives

- Test single card navigation end-to-end
- Verify VSCode editor responses to mock events
- Establish baseline performance metrics

### Tasks

#### 2.1 Single Card Navigation Tests

**Duration**: 2-3 days

Create `src/test/suite/e2e/navigation.test.ts`:

```typescript
suite("E2E Navigation Tests", () => {
  let mockMiroClient: MockMiroClient;
  let extension: vscode.Extension<any>;

  setup(async () => {
    mockMiroClient = new MockMiroClient();
    mockMiroClient.loadTestCards(TEST_CARDS);
    await mockMiroClient.connect();
  });

  test("navigateToCard opens correct file and position", async () => {
    const testCard = TEST_CARDS[0]; // UserProfile.render

    // Simulate card open event from mock Miro board
    mockMiroClient.simulateCardOpen(testCard.miroLink!);

    // Verify VSCode response
    await waitFor(async () => {
      const activeEditor = vscode.window.activeTextEditor;
      assert.ok(activeEditor, "No active editor");
      assert.ok(activeEditor.document.fileName.endsWith("UserProfile.ts"));

      const position = activeEditor.selection.active;
      const symbolRange = await findSymbolRange(
        "render",
        activeEditor.document,
      );
      assert.ok(
        symbolRange.contains(position),
        "Cursor not at symbol location",
      );
    });
  });
});
```

**Verification Checkpoint**: Single card navigation works reliably with correct file opening and cursor positioning.

#### 2.2 Card Storage Integration Tests

**Duration**: 1-2 days

Test card storage updates during navigation:

```typescript
test("navigation updates card storage correctly", async () => {
  const testCard = TEST_CARDS[0];

  mockMiroClient.simulateCardOpen(testCard.miroLink!);

  await waitFor(() => {
    const storedCard = cardStorage.getCardByLink(testCard.miroLink!);
    assert.deepEqual(storedCard, testCard);
  });
});
```

**Verification Checkpoint**: Card storage maintains consistency with navigation events.

#### 2.3 Error Handling Tests

**Duration**: 1 day

Test graceful handling of invalid card data:

```typescript
test("handles invalid card data gracefully", async () => {
  const invalidCard = { ...TEST_CARDS[0], path: "nonexistent/file.ts" };

  mockMiroClient.simulateCardOpen(invalidCard.miroLink!);

  // Should not crash, should show appropriate error
  await waitFor(async () => {
    const notifications = await getVSCodeNotifications();
    assert.ok(notifications.some((n) => n.type === "error"));
  });
});
```

**Verification Checkpoint**: Extension handles errors gracefully without crashing.

### Phase 2 Success Criteria

- [ ] Single card navigation works consistently
- [ ] Correct files open at precise symbol locations
- [ ] Card storage updates correctly
- [ ] Error scenarios handled gracefully
- [ ] No memory leaks or performance degradation

## Phase 3: Complex Interaction Scenarios

### Objectives

- Test multi-card navigation sequences
- Verify card creation and attachment workflows
- Test concurrent operations and edge cases

### Tasks

#### 3.1 Multi-Card Navigation Tests

**Duration**: 2-3 days

```typescript
test("sequential navigation between multiple cards", async () => {
  const cards = TEST_CARDS.slice(0, 3);

  for (const card of cards) {
    mockMiroClient.simulateCardOpen(card.miroLink!);

    await waitFor(async () => {
      const activeEditor = vscode.window.activeTextEditor;
      assert.ok(activeEditor?.document.fileName.includes(card.path));
    });

    // Brief pause to simulate realistic usage
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  // Verify all files remain open in editor tabs
  assert.equal(vscode.window.tabGroups.all[0].tabs.length, 3);
});
```

**Verification Checkpoint**: Multiple navigation events work in sequence without interference.

#### 3.2 Card Lifecycle Tests

**Duration**: 2-3 days

Test complete card workflows:

```typescript
test("card creation, attachment, and navigation workflow", async () => {
  // 1. Create new card
  await vscode.commands.executeCommand("app-explorer.createCard");

  // 2. Simulate Miro card creation response
  const newCard = createTestCard("NewComponent.init");
  mockMiroClient.simulateCardUpdate(newCard);

  // 3. Navigate to the card
  mockMiroClient.simulateCardOpen(newCard.miroLink!);

  // 4. Verify end-to-end workflow
  await waitFor(() => {
    const storedCard = cardStorage.getCardByLink(newCard.miroLink!);
    assert.ok(storedCard);

    const activeEditor = vscode.window.activeTextEditor;
    assert.ok(activeEditor?.document.fileName.includes(newCard.path));
  });
});
```

**Verification Checkpoint**: Complete card workflows function correctly.

#### 3.3 Concurrent Operations Tests

**Duration**: 1-2 days

Test handling of rapid or concurrent events:

```typescript
test("handles rapid navigation events", async () => {
  const cards = TEST_CARDS.slice(0, 5);

  // Emit multiple navigation events rapidly
  cards.forEach((card, index) => {
    setTimeout(
      () => mockMiroClient.simulateCardOpen(card.miroLink!),
      index * 50,
    );
  });

  // Verify final state is consistent
  await waitFor(
    async () => {
      const activeEditor = vscode.window.activeTextEditor;
      const lastCard = cards[cards.length - 1];
      assert.ok(activeEditor?.document.fileName.includes(lastCard.path));
    },
    { timeout: 5000 },
  );
});
```

**Verification Checkpoint**: System handles concurrent operations without race conditions.

### Phase 3 Success Criteria

- [ ] Multi-card navigation sequences work reliably
- [ ] Complete card workflows function end-to-end
- [ ] Concurrent operations handled correctly
- [ ] Performance remains acceptable under load
- [ ] No race conditions or state corruption

## Phase 4: Migration Architecture Integration

### Objectives

- Test workspace websocket client scenarios
- Verify server discovery and health monitoring
- Test dual storage synchronization

### Tasks

#### 4.1 Workspace WebSocket Client Tests

**Duration**: 2-3 days

Test new workspace client architecture:

```typescript
test("workspace websocket client navigation", async () => {
  // Enable workspace websocket feature flag
  await vscode.workspace
    .getConfiguration("appExplorer.migration")
    .update("enableWorkspaceWebsockets", true);

  const workspaceClient = new MockWorkspaceWebsocketClient();
  const testCard = TEST_CARDS[0];

  workspaceClient.emitNavigateToCard(testCard);

  await waitFor(async () => {
    const activeEditor = vscode.window.activeTextEditor;
    assert.ok(activeEditor?.document.fileName.includes(testCard.path));
  });
});
```

**Verification Checkpoint**: New workspace client architecture works with existing navigation.

#### 4.2 Server Discovery Tests

**Duration**: 1-2 days

Test server discovery and failover scenarios:

```typescript
test("server discovery and failover", async () => {
  const mockServerDiscovery = new MockServerDiscovery();

  // Simulate server failure
  mockServerDiscovery.simulateServerFailure();

  // Verify failover to backup server
  await waitFor(() => {
    assert.ok(mockServerDiscovery.isConnectedToBackupServer());
  });

  // Test navigation still works
  mockMiroClient.simulateCardOpen(TEST_CARDS[0].miroLink!);

  await waitFor(async () => {
    const activeEditor = vscode.window.activeTextEditor;
    assert.ok(activeEditor);
  });
});
```

**Verification Checkpoint**: Server failover maintains functionality.

#### 4.3 Dual Storage Synchronization Tests

**Duration**: 2 days

Test synchronization between client and server storage:

```typescript
test("dual storage synchronization", async () => {
  // Enable dual storage feature flag
  await vscode.workspace
    .getConfiguration("appExplorer.migration")
    .update("enableDualStorage", true);

  const testCard = TEST_CARDS[0];

  // Update card via MockMiroClient
  mockMiroClient.simulateCardUpdate(testCard);

  // Verify client storage synchronizes
  await waitFor(() => {
    const clientCard = cardStorage.getCardByLink(testCard.miroLink!);
    assert.deepEqual(clientCard, testCard);
  });
});
```

**Verification Checkpoint**: Storage synchronization works correctly.

### Phase 4 Success Criteria

- [ ] Workspace websocket client integration works
- [ ] Server discovery and failover function correctly
- [ ] Dual storage synchronization maintains consistency
- [ ] Migration features don't break existing functionality
- [ ] Performance impact is acceptable

## Implementation Guidelines

### Test Organization

```
src/test/
├── suite/
│   ├── unit/                    # Existing unit tests
│   └── e2e/                     # New E2E tests
│       ├── navigation.test.ts
│       ├── card-lifecycle.test.ts
│       ├── concurrent-ops.test.ts
│       └── migration.test.ts
├── mocks/
│   ├── mock-miro-client.ts
│   ├── mock-workspace-client.ts
│   └── mock-server-discovery.ts
├── fixtures/
│   ├── card-data.ts
│   └── test-workspace-config.ts
└── helpers/
    ├── e2e-test-utils.ts
    └── verification-helpers.ts
```

### Configuration

Add E2E-specific configuration to `.vscode-test.mjs`:

```javascript
export default defineConfig({
  files: "out/test/**/*.test.js",
  workspaceFolder: "./sample-workspace",
  mocha: {
    timeout: 60000, // Longer timeout for E2E tests
    slow: 20000,
    grep: process.env.TEST_PATTERN || ".*",
  },
  extensionDevelopmentPath: ".",
  extensionTestsPath: "./out/test/suite/e2e",
});
```

### Verification Helpers

Create comprehensive verification utilities:

```typescript
export class E2EVerificationHelper {
  static async verifyFileOpened(expectedPath: string): Promise<void>;
  static async verifyCursorPosition(expectedSymbol: string): Promise<void>;
  static async verifyCardStorageState(expectedCards: CardData[]): Promise<void>;
  static async verifyNoMemoryLeaks(): Promise<void>;
  static async capturePerformanceMetrics(): Promise<PerformanceMetrics>;
}
```

## Success Metrics

### Reliability Metrics

- **Test Pass Rate**: >95% on all supported platforms
- **Flaky Test Rate**: <2% across all test runs
- **Test Execution Time**: <5 minutes for full E2E suite

### Coverage Metrics

- **Navigation Scenarios**: 100% of core navigation paths
- **Error Conditions**: 90% of identified error scenarios
- **Integration Points**: 100% of WebSocket event types

### Performance Metrics

- **Navigation Response Time**: <500ms for single card navigation
- **Memory Usage**: No leaks detected over 100 navigation operations
- **Concurrent Operations**: Handle 10+ rapid events without errors

## Maintenance and Evolution

### Regular Maintenance Tasks

1. **Weekly**: Review test results and address flaky tests
2. **Monthly**: Update test data and scenarios based on new features
3. **Quarterly**: Performance benchmarking and optimization
4. **Per Release**: Comprehensive E2E test execution and validation

### Evolution Strategy

- **Phase 5**: Integration with CI/CD pipelines
- **Phase 6**: Cross-platform testing (Windows, macOS, Linux)
- **Phase 7**: Performance regression testing
- **Phase 8**: User scenario-based testing

This comprehensive E2E testing strategy provides a solid foundation for reliable, automated testing of AppExplorer's Miro integration while supporting the project's evolving architecture and requirements.
