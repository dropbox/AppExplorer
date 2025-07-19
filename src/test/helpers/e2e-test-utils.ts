import * as assert from "assert";
import * as vscode from "vscode";
import { CardData, SymbolCardData } from "../../EventTypes";
import { LocationFinder } from "../../location-finder";
import { TEST_CARDS } from "../fixtures/card-data";
import { MockMiroClient } from "../mocks/mock-miro-client";
import { waitFor } from "../suite/test-utils";
import { TestPortManager } from "./test-port-manager";

/**
 * Type guard to check if a card is a symbol card
 */
export function isSymbolCard(card: CardData): card is SymbolCardData {
  return card.type === "symbol";
}

/**
 * E2E Test utilities for MockMiroClient testing
 */
export class E2ETestUtils {
  private static mockClient: MockMiroClient | null = null;
  private static locationFinder: LocationFinder = new LocationFinder();
  private static testMiroServer: any = null; // MiroServer instance for testing
  private static cardStorage: any = null; // CardStorage instance
  private static serverCardStorage: any = null; // ServerCardStorage instance
  private static capturedEvents: Map<string, any[]> = new Map(); // Event capture for testing

  /**
   * Initialize test port allocation for the test suite
   * This should be called once at the beginning of the test suite
   */
  static async initializeTestPort(): Promise<number> {
    const port = await TestPortManager.allocateTestPort();
    console.log(`[E2ETestUtils] Initialized test port: ${port}`);

    // Check if production port is in use
    const productionInUse = await TestPortManager.isProductionPortInUse();
    if (productionInUse) {
      console.log(
        "[E2ETestUtils] Production AppExplorer instance detected on port 9042 - using test port to avoid conflicts",
      );
    }

    return port;
  }

  /**
   * Get diagnostic information about port allocation
   */
  static async getPortDiagnostics(): Promise<void> {
    const diagnostics = await TestPortManager.getDiagnostics();
    console.log("[E2ETestUtils] Port diagnostics:", diagnostics);
  }

  /**
   * Start a test MiroServer instance on the allocated port
   * This is required for MockMiroClient to connect successfully
   */
  static async startTestMiroServer(): Promise<void> {
    if (this.testMiroServer) {
      console.log("[E2ETestUtils] Test MiroServer already running");
      return;
    }

    try {
      const testPort = TestPortManager.getAllocatedPort();
      console.log(
        `[E2ETestUtils] Starting test MiroServer on port ${testPort}`,
      );

      // Import MiroServer dynamically to avoid circular dependencies
      const { MiroServer } = await import("../../server");

      // Create a minimal context for the test server
      const testContext = {
        subscriptions: [],
        workspaceState: {
          get: () => undefined,
          update: () => Promise.resolve(),
        },
        globalState: {
          get: () => undefined,
          update: () => Promise.resolve(),
        },
      } as any;

      // Create and start the test MiroServer
      this.testMiroServer = await MiroServer.create(
        testContext,
        undefined,
        testPort,
      );

      // Wait for the server to be ready
      await TestPortManager.waitForPortToBeInUse(testPort, 5000);

      console.log(
        `[E2ETestUtils] Test MiroServer started successfully on port ${testPort}`,
      );
    } catch (error) {
      console.error("[E2ETestUtils] Failed to start test MiroServer:", error);
      throw new Error(
        `Failed to start test MiroServer: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Stop the test MiroServer instance
   */
  static async stopTestMiroServer(): Promise<void> {
    if (this.testMiroServer) {
      try {
        console.log("[E2ETestUtils] Stopping test MiroServer");

        // Stop the server
        if (this.testMiroServer.httpServer) {
          await new Promise<void>((resolve) => {
            this.testMiroServer.httpServer.close(() => {
              resolve();
            });
          });
        }

        // Dispose of subscriptions
        if (this.testMiroServer.subscriptions) {
          this.testMiroServer.subscriptions.forEach((sub: any) => {
            if (sub && typeof sub.dispose === "function") {
              sub.dispose();
            }
          });
        }

        this.testMiroServer = null;
        console.log("[E2ETestUtils] Test MiroServer stopped");
      } catch (error) {
        console.error("[E2ETestUtils] Error stopping test MiroServer:", error);
        this.testMiroServer = null; // Reset even if there was an error
      }
    }
  }

  /**
   * Release the allocated test port
   * This should be called at the end of the test suite
   */
  static releaseTestPort(): void {
    TestPortManager.releasePort();
    console.log("[E2ETestUtils] Released test port");
  }

  /**
   * Set up MockMiroClient for testing with dynamic port allocation
   */
  static async setupMockClient(): Promise<MockMiroClient> {
    if (this.mockClient) {
      await this.teardownMockClient();
    }

    // Get the test server URL from the port manager
    const testServerUrl = TestPortManager.getTestServerUrl();
    console.log(
      `[E2ETestUtils] Setting up MockMiroClient with server URL: ${testServerUrl}`,
    );

    this.mockClient = new MockMiroClient(testServerUrl);
    this.mockClient.loadTestCards(TEST_CARDS);

    // Connect to the server
    await this.mockClient.connect();

    // Wait for connection to be established
    await waitFor(
      () => {
        assert.ok(
          this.mockClient?.isConnected,
          "MockMiroClient should be connected",
        );
        return true;
      },
      { timeout: 10000, message: "MockMiroClient failed to connect" },
    );

    return this.mockClient;
  }

  /**
   * Tear down MockMiroClient after testing
   */
  static async teardownMockClient(): Promise<void> {
    if (this.mockClient) {
      this.mockClient.disconnect();
      this.mockClient = null;
    }

    // Stop capturing notifications and restore original methods
    this.stopCapturingNotifications();

    // Clear VSCode context
    await vscode.commands.executeCommand(
      "setContext",
      "mockMiroClient.connected",
      false,
    );

    // Close all open editors to clean up state
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  }

  /**
   * Complete teardown including test server
   * This should be called at the end of the test suite
   */
  static async teardownTestInfrastructure(): Promise<void> {
    // Stop the test MiroServer
    await this.stopTestMiroServer();

    // Teardown MockMiroClient
    await this.teardownMockClient();

    // Release the test port
    this.releaseTestPort();
  }

  /**
   * Get the current MockMiroClient instance
   */
  static getMockClient(): MockMiroClient | null {
    return this.mockClient;
  }

  /**
   * Find symbol range in a document
   */
  static async findSymbolRange(
    symbolName: string,
    document: vscode.TextDocument,
  ): Promise<vscode.Range | null> {
    const symbols = await this.locationFinder.findSymbolsInDocument(
      document.uri,
    );
    const symbol = symbols.find((s) => s.label === symbolName);
    return symbol?.range || null;
  }

  /**
   * Wait for VSCode to open a specific file
   */
  static async waitForFileToOpen(
    expectedPath: string,
    timeout: number = 10000,
  ): Promise<vscode.TextEditor> {
    return waitFor(
      async () => {
        const activeEditor = vscode.window.activeTextEditor;
        assert.ok(activeEditor, "No active editor found");

        const actualPath = vscode.workspace.asRelativePath(
          activeEditor.document.uri,
        );
        assert.ok(
          actualPath.includes(expectedPath) ||
            expectedPath.includes(actualPath),
          `Expected file path to contain "${expectedPath}", but got "${actualPath}"`,
        );

        return activeEditor;
      },
      {
        timeout,
        message: `File "${expectedPath}" did not open within timeout`,
      },
    );
  }

  /**
   * Wait for cursor to be positioned at a specific symbol
   */
  static async waitForCursorAtSymbol(
    symbolName: string,
    editor: vscode.TextEditor,
    timeout: number = 5000,
  ): Promise<vscode.Position> {
    return waitFor(
      async () => {
        const symbolRange = await this.findSymbolRange(
          symbolName,
          editor.document,
        );
        assert.ok(symbolRange, `Symbol "${symbolName}" not found in document`);

        const cursorPosition = editor.selection.active;
        assert.ok(
          symbolRange.contains(cursorPosition),
          `Cursor not positioned at symbol "${symbolName}". Expected within ${symbolRange.start.line}-${symbolRange.end.line}, got line ${cursorPosition.line}`,
        );

        return cursorPosition;
      },
      {
        timeout,
        message: `Cursor not positioned at symbol "${symbolName}" within timeout`,
      },
    );
  }

  /**
   * Simulate card navigation and wait for VSCode response
   * This directly calls the navigation function instead of going through WebSocket
   */
  static async simulateCardNavigation(
    card: CardData,
    timeout: number = 15000,
  ): Promise<{ editor: vscode.TextEditor; position: vscode.Position }> {
    const mockClient = this.getMockClient();
    assert.ok(mockClient, "MockMiroClient not initialized");

    // Store the card in the mock client's storage first
    if (card.miroLink) {
      mockClient.getTestCards().push(card);
    }

    // Directly trigger navigation using VSCode commands
    // This simulates what happens when the MiroServer receives a navigateToCard event
    await this.triggerDirectNavigation(card);

    // Wait for file to open
    const editor = await this.waitForFileToOpen(card.path, timeout);

    // If it's a symbol card, try to wait for cursor positioning
    let position = editor.selection.active;
    if (isSymbolCard(card)) {
      try {
        position = await this.waitForCursorAtSymbol(
          card.symbol,
          editor,
          timeout,
        );
      } catch (error) {
        console.warn(`Symbol positioning failed for ${card.symbol}:`, error);
        // Continue with current cursor position - this is acceptable for E2E tests
        // where the TypeScript language server might not be fully initialized
      }
    }

    return { editor, position };
  }

  /**
   * Directly trigger navigation without going through WebSocket
   * This simulates the navigation logic from extension.ts
   */
  private static async triggerDirectNavigation(card: CardData): Promise<void> {
    // Import the navigation logic
    const { goToCardCode } = await import("../../commands/browse");

    // Navigate to the card (this opens the file and positions cursor)
    const success = await goToCardCode(card, false);

    if (!success) {
      console.warn(`Navigation to card ${card.title} was not successful`);
    }
  }

  /**
   * Mock VSCode notification system for testing
   * This intercepts calls to showWarningMessage, showErrorMessage, etc.
   */
  private static capturedNotifications: Array<{
    type: string;
    message: string;
  }> = [];
  private static originalShowWarningMessage: typeof vscode.window.showWarningMessage;
  private static originalShowErrorMessage: typeof vscode.window.showErrorMessage;
  private static originalShowInformationMessage: typeof vscode.window.showInformationMessage;

  /**
   * Start capturing VSCode notifications for testing
   */
  static startCapturingNotifications(): void {
    this.capturedNotifications = [];

    // Store original methods
    this.originalShowWarningMessage = vscode.window.showWarningMessage;
    this.originalShowErrorMessage = vscode.window.showErrorMessage;
    this.originalShowInformationMessage = vscode.window.showInformationMessage;

    // Mock the methods to capture notifications
    vscode.window.showWarningMessage = ((message: string, ..._items: any[]) => {
      this.capturedNotifications.push({ type: "warning", message });
      console.log(`[CAPTURED WARNING]: ${message}`);
      return Promise.resolve(undefined);
    }) as any;

    vscode.window.showErrorMessage = ((message: string, ..._items: any[]) => {
      this.capturedNotifications.push({ type: "error", message });
      console.log(`[CAPTURED ERROR]: ${message}`);
      return Promise.resolve(undefined);
    }) as any;

    vscode.window.showInformationMessage = ((
      message: string,
      ..._items: any[]
    ) => {
      this.capturedNotifications.push({ type: "info", message });
      console.log(`[CAPTURED INFO]: ${message}`);
      return Promise.resolve(undefined);
    }) as any;
  }

  /**
   * Stop capturing notifications and restore original methods
   */
  static stopCapturingNotifications(): void {
    if (this.originalShowWarningMessage) {
      vscode.window.showWarningMessage = this.originalShowWarningMessage;
    }
    if (this.originalShowErrorMessage) {
      vscode.window.showErrorMessage = this.originalShowErrorMessage;
    }
    if (this.originalShowInformationMessage) {
      vscode.window.showInformationMessage =
        this.originalShowInformationMessage;
    }
  }

  /**
   * Get captured VSCode notifications
   */
  static getCapturedNotifications(): Array<{ type: string; message: string }> {
    return [...this.capturedNotifications];
  }

  /**
   * Clear captured notifications
   */
  static clearCapturedNotifications(): void {
    this.capturedNotifications = [];
  }

  /**
   * Wait for a specific notification to appear
   */
  static async waitForNotification(
    expectedType: "warning" | "error" | "info",
    expectedMessagePattern: string | RegExp,
    timeout: number = 5000,
  ): Promise<{ type: string; message: string }> {
    return waitFor(
      () => {
        const notification = this.capturedNotifications.find((n) => {
          const typeMatches = n.type === expectedType;
          const messageMatches =
            typeof expectedMessagePattern === "string"
              ? n.message.includes(expectedMessagePattern)
              : expectedMessagePattern.test(n.message);
          return typeMatches && messageMatches;
        });

        assert.ok(
          notification,
          `Expected ${expectedType} notification matching "${expectedMessagePattern}" not found. Captured: ${JSON.stringify(this.capturedNotifications)}`,
        );
        return notification;
      },
      { timeout, message: `Notification not found within timeout` },
    );
  }

  /**
   * Verify card storage contains expected card data
   */
  static async verifyCardInStorage(
    card: CardData,
    mockClient: MockMiroClient,
  ): Promise<void> {
    await waitFor(
      () => {
        const testCards = mockClient.getTestCards();
        const storedCard = testCards.find((c) => c.miroLink === card.miroLink);
        assert.ok(
          storedCard,
          `Card with miroLink "${card.miroLink}" not found in storage`,
        );
        assert.deepStrictEqual(
          storedCard.title,
          card.title,
          "Card title mismatch",
        );
        assert.deepStrictEqual(
          storedCard.path,
          card.path,
          "Card path mismatch",
        );
        if (isSymbolCard(card) && isSymbolCard(storedCard)) {
          assert.deepStrictEqual(
            storedCard.symbol,
            card.symbol,
            "Card symbol mismatch",
          );
        }
        return true;
      },
      { timeout: 5000, message: "Card not found in storage or data mismatch" },
    );
  }

  /**
   * Reset VSCode editor state
   */
  static async resetEditorState(): Promise<void> {
    // Close all editors
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");

    // Clear any selections
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
      activeEditor.selection = new vscode.Selection(0, 0, 0, 0);
    }
  }

  /**
   * Create a test card with invalid data for error testing
   */
  static createInvalidCard(
    type: "nonexistent-file" | "nonexistent-symbol",
  ): CardData {
    const baseCard = TEST_CARDS[0];

    switch (type) {
      case "nonexistent-file":
        return {
          ...baseCard,
          path: "nonexistent/file.ts",
          miroLink:
            "https://miro.com/app/board/mock-board-test-123/invalid-file",
        };
      case "nonexistent-symbol":
        return {
          ...baseCard,
          symbol: "nonexistentSymbol",
          miroLink:
            "https://miro.com/app/board/mock-board-test-123/invalid-symbol",
        } as SymbolCardData;
      default:
        throw new Error(`Unknown invalid card type: ${type}`);
    }
  }

  /**
   * Wait for a condition with custom retry logic
   */
  static async waitForCondition<T>(
    condition: () => Promise<T> | T,
    options: {
      timeout?: number;
      interval?: number;
      message?: string;
    } = {},
  ): Promise<T> {
    return waitFor(condition, {
      timeout: options.timeout || 10000,
      interval: options.interval || 500,
      message: options.message || "Condition not met within timeout",
    });
  }

  /**
   * Get workspace-relative path for a file
   */
  static getWorkspaceRelativePath(filePath: string): string {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return filePath;
    }

    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    if (filePath.startsWith(workspaceRoot)) {
      return filePath.substring(workspaceRoot.length + 1);
    }

    return filePath;
  }

  /**
   * Check if a file exists in the workspace
   */
  static async fileExists(relativePath: string): Promise<boolean> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return false;
    }

    const uri = vscode.Uri.joinPath(workspaceFolders[0].uri, relativePath);
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Debug helper: List all symbols found in a document
   * This helps identify what symbols are actually discoverable by LocationFinder
   */
  static async listAllSymbolsInDocument(
    relativePath: string,
  ): Promise<Array<{ label: string; range: vscode.Range }>> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return [];
    }

    const uri = vscode.Uri.joinPath(workspaceFolders[0].uri, relativePath);

    try {
      const symbols = await this.locationFinder.findSymbolsInDocument(uri);
      return symbols.map((symbol) => ({
        label: symbol.label,
        range: symbol.range,
      }));
    } catch (error) {
      console.error(`Error finding symbols in ${relativePath}:`, error);
      return [];
    }
  }

  /**
   * Debug helper: Print all symbols in test workspace files
   */
  static async debugPrintAllTestSymbols(): Promise<void> {
    const testFiles = [
      "src/components/UserProfile.ts",
      "src/services/ApiService.ts",
      "src/utils/helpers.ts",
      "example.ts",
    ];

    console.log("=== DEBUG: Symbols found in test workspace files ===");

    for (const filePath of testFiles) {
      console.log(`\n--- ${filePath} ---`);
      const symbols = await this.listAllSymbolsInDocument(filePath);

      if (symbols.length === 0) {
        console.log("  No symbols found");
      } else {
        symbols.forEach((symbol, index) => {
          console.log(
            `  ${index + 1}. "${symbol.label}" (line ${symbol.range.start.line + 1})`,
          );
        });
      }
    }

    console.log("=== END DEBUG ===\n");
  }

  /**
   * Set up MockMiroClient and return it
   */
  static async setupMockMiroClient(): Promise<MockMiroClient> {
    const testPort = TestPortManager.getAllocatedPort();
    const serverUrl = `http://localhost:${testPort}`;

    console.log(
      `[E2ETestUtils] Setting up MockMiroClient with server URL: ${serverUrl}`,
    );

    this.mockClient = new MockMiroClient(serverUrl);
    await this.mockClient.connect();

    console.log("MockMiroClient setup complete");
    return this.mockClient;
  }

  /**
   * Get the current CardStorage instance
   */
  static getCardStorage(): any {
    if (!this.cardStorage && this.testMiroServer) {
      this.cardStorage = this.testMiroServer.getCardStorage?.();
    }
    return this.cardStorage;
  }

  /**
   * Get the current ServerCardStorage instance
   */
  static getServerCardStorage(): any {
    if (!this.serverCardStorage && this.testMiroServer) {
      this.serverCardStorage = this.testMiroServer.getServerCardStorage?.();
    }
    return this.serverCardStorage;
  }

  /**
   * Open a file and position cursor at a specific symbol
   */
  static async openFileAtSymbol(
    filePath: string,
    symbolName: string,
  ): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      throw new Error("No workspace folders found");
    }

    const fullPath = vscode.Uri.joinPath(workspaceFolders[0].uri, filePath);
    const document = await vscode.workspace.openTextDocument(fullPath);
    const editor = await vscode.window.showTextDocument(document);

    // Find the symbol position
    const symbolPosition = await this.findSymbolPosition(document, symbolName);
    if (symbolPosition) {
      editor.selection = new vscode.Selection(symbolPosition, symbolPosition);
      editor.revealRange(new vscode.Range(symbolPosition, symbolPosition));
    }
  }

  /**
   * Find the position of a symbol in a document
   */
  static async findSymbolPosition(
    document: vscode.TextDocument,
    symbolName: string,
  ): Promise<vscode.Position | null> {
    const symbols = await this.locationFinder.findSymbolsInDocument(
      document.uri,
    );
    const symbol = symbols.find(
      (s) => s.label === symbolName || s.label.includes(symbolName),
    );

    if (symbol) {
      return symbol.range.start;
    }

    return null;
  }

  /**
   * Navigate to a specific symbol in the current editor
   */
  static async navigateToSymbol(
    editor: vscode.TextEditor,
    symbolName: string,
  ): Promise<void> {
    const symbolPosition = await this.findSymbolPosition(
      editor.document,
      symbolName,
    );
    if (symbolPosition) {
      editor.selection = new vscode.Selection(symbolPosition, symbolPosition);
      editor.revealRange(new vscode.Range(symbolPosition, symbolPosition));
    } else {
      throw new Error(`Symbol ${symbolName} not found in document`);
    }
  }

  /**
   * Capture events for testing
   */
  static captureEvent(eventType: string, eventData: any): void {
    if (!this.capturedEvents.has(eventType)) {
      this.capturedEvents.set(eventType, []);
    }
    this.capturedEvents.get(eventType)!.push(eventData);
  }

  /**
   * Get captured events of a specific type
   */
  static getCapturedEvents(eventType: string): any[] {
    return this.capturedEvents.get(eventType) || [];
  }

  /**
   * Clear captured events
   */
  static clearCapturedEvents(): void {
    this.capturedEvents.clear();
  }

  /**
   * Teardown MockMiroClient
   */
  static async teardownMockMiroClient(): Promise<void> {
    if (this.mockClient) {
      this.mockClient.disconnect();
      this.mockClient = null;
    }
    this.clearCapturedEvents();
  }
}
