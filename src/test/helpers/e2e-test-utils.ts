import * as assert from "assert";

import createDebug from "debug";
import * as vscode from "vscode";
import { CardData, SymbolCardData } from "../../EventTypes";
import { LocationFinder } from "../../location-finder";
import { MiroServer } from "../../server";
import { TEST_CARDS } from "../fixtures/card-data";
import { MockMiroClient } from "../mocks/mock-miro-client";
import { waitFor } from "../suite/test-utils";

const debug = createDebug("app-explorer:test:e2e");

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
  private static testMiroServer: MiroServer | null = null; // MiroServer instance for testing
  private static capturedEvents: Map<string, any[]> = new Map(); // Event capture for testing

  /**
   * Get the test port from environment variable
   * This should be called to get the port for server communication
   */
  static getTestPort(): number {
    const envPort = process.env.APP_EXPLORER_PORT;
    if (!envPort) {
      throw new Error(
        "APP_EXPLORER_PORT environment variable not set. Test configuration may be incorrect.",
      );
    }

    const port = parseInt(envPort, 10);
    if (isNaN(port)) {
      throw new Error(
        `Invalid APP_EXPLORER_PORT value: ${envPort}. Must be a valid port number.`,
      );
    }

    debug(`[E2ETestUtils] Using test port from environment: ${port}`);
    return port;
  }

  /**
   * Get diagnostic information about port allocation
   */
  static getPortDiagnostics(): void {
    const testPort = this.getTestPort();

    debug("[E2ETestUtils] Using test port from environment:", testPort);
  }

  /**
   * Clean up test resources and release allocated port
   * Should be called in test teardown to ensure proper cleanup
   */
  static async cleanup(): Promise<void> {
    debug("[E2ETestUtils] Cleaning up test resources");

    // Additional cleanup can be added here as needed
    debug("[E2ETestUtils] Cleanup complete");
  }

  /**
   * Start a test MiroServer instance on the configured port
   * This is required for MockMiroClient to connect successfully
   * Uses environment variable for cross-process port configuration
   */
  static async startRealServerOnTestPort(): Promise<void> {
    const testPort = this.getTestPort();
    debug(`[E2ETestUtils] Using test port from environment: ${testPort}`);

    // Ensure the extension is activated before trying to use its commands
    const extension = vscode.extensions.getExtension("dropbox.app-explorer");
    if (extension && !extension.isActive) {
      debug("[E2ETestUtils] Activating AppExplorer extension...");
      await extension.activate();
      debug("[E2ETestUtils] Extension activated successfully");
    }

    // The extension should have started the server during activation
    // Let's give it some time and check if it's running
    debug(
      "[E2ETestUtils] Checking if server started during extension activation...",
    );

    // Give the server more time to start (extension activation can be slow)
    debug("[E2ETestUtils] Waiting for server to start...");

    // Verify the server is running on the expected port
    for (let tries = 0; tries < 3; tries++) {
      try {
        const response = await fetch(`http://localhost:${testPort}/health`);
        if (response.ok) {
          debug(
            `[E2ETestUtils] Server started successfully on port ${testPort}`,
          );
          break;
        } else {
          throw new Error(`Server health check failed: ${response.status}`);
        }
      } catch (error) {
        console.error("[E2ETestUtils] Server failed to start:", error);
        if (tries < 3) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }
        throw new Error(
          `Server failed to start on port ${testPort}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /**
   * Stop the test MiroServer instance
   */
  static async stopTestMiroServer(): Promise<void> {
    if (this.testMiroServer) {
      try {
        debug("[E2ETestUtils] Stopping test MiroServer");

        // Stop the server
        if (this.testMiroServer?.httpServer) {
          await new Promise<void>((resolve) => {
            this.testMiroServer?.httpServer.close(() => {
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
        debug("[E2ETestUtils] Test MiroServer stopped");
      } catch (error) {
        console.error("[E2ETestUtils] Error stopping test MiroServer:", error);
        this.testMiroServer = null; // Reset even if there was an error
      }
    }
  }

  /**
   * Set up MockMiroClient for testing with dynamic port allocation
   */
  static async setupMockClient(): Promise<MockMiroClient> {
    if (this.mockClient) {
      await this.teardownMockClient();
    }

    // Get the test server URL from environment variable
    const testPort = this.getTestPort();
    const testServerUrl = `http://localhost:${testPort}`;

    debug(
      `[E2ETestUtils] Setting up MockMiroClient with server URL: ${testServerUrl}`,
    );

    this.mockClient = new MockMiroClient(testServerUrl);
    await this.mockClient.loadTestCards(TEST_CARDS);

    assert.equal(
      this.mockClient.getTestCards().length,
      TEST_CARDS.length,
      "Expected test cards to be loaded into mock client",
    );

    // Connect to the server
    await this.mockClient.connect();

    // Wait for connection to be established
    await waitFor(
      () => {
        assert.ok(
          this.mockClient?.isConnected,
          "MockMiroClient should be connected",
        );
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

    debug("[E2ETestUtils] Test infrastructure teardown complete");
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
  static async navigateToCard(card: CardData): Promise<void> {
    const mockClient = this.getMockClient();
    assert.ok(mockClient, "MockMiroClient not initialized");
    debug("[E2ETestUtils] Navigating to card: %O", card);

    // Store the card in the mock client's storage first
    if (card.miroLink) {
      mockClient.setCard(card);
    }
    const storedCard = mockClient
      .getTestCards()
      .find((c) => c.miroLink === card.miroLink);
    assert.ok(storedCard, "Card not found in mock client storage");

    await mockClient.sendNavigateToEvent(card);
  }

  /**
   * Create a Sinon-based notification capture system
   * This is the recommended approach for new tests
   */
  static createSinonNotificationCapture(): {
    sandbox: any;
    getCapturedNotifications: () => Array<{ type: string; message: string }>;
    clearCapturedNotifications: () => void;
  } {
    const sinon = require("sinon");
    const sandbox = sinon.createSandbox();
    const capturedNotifications: Array<{ type: string; message: string }> = [];

    // Mock notification methods with Sinon
    sandbox
      .stub(vscode.window, "showWarningMessage")
      .callsFake((message: string) => {
        capturedNotifications.push({ type: "warning", message });
        debug(`[CAPTURED WARNING]: ${message}`);
        return Promise.resolve(undefined);
      });

    sandbox
      .stub(vscode.window, "showErrorMessage")
      .callsFake((message: string) => {
        capturedNotifications.push({ type: "error", message });
        debug(`[CAPTURED ERROR]: ${message}`);
        return Promise.resolve(undefined);
      });

    sandbox
      .stub(vscode.window, "showInformationMessage")
      .callsFake((message: string) => {
        capturedNotifications.push({ type: "info", message });
        debug(`[CAPTURED INFO]: ${message}`);
        return Promise.resolve(undefined);
      });

    return {
      sandbox,
      getCapturedNotifications: () => [...capturedNotifications],
      clearCapturedNotifications: () => (capturedNotifications.length = 0),
    };
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

  static async enableAllFeatureFlags(): Promise<void> {
    const config = vscode.workspace.getConfiguration("appExplorer.migration");
    for (const flag of Object.keys(config)) {
      if (flag.includes("enable") || flag.includes("debug")) {
        if (config.get(flag) === false) {
          await config.update(flag, true);
        }
      }
    }
  }

  static async setupWorkspace(): Promise<void> {
    debug("Setting up E2E Navigation Test Suite...");
    await this.enableAllFeatureFlags();

    // Get test port from environment variable
    const testPort = E2ETestUtils.getTestPort();
    debug(`E2E Test Suite will use port: ${testPort}`);

    // Start the test MiroServer on the allocated port
    await this.startRealServerOnTestPort();

    // Verify test workspace is properly configured
    const workspaceFolders = vscode.workspace.workspaceFolders;
    assert.ok(
      workspaceFolders && workspaceFolders.length === 1,
      "No workspace folders found",
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

    debug("=== DEBUG: Symbols found in test workspace files ===");

    for (const filePath of testFiles) {
      debug(`\n--- ${filePath} ---`);
      const symbols = await this.listAllSymbolsInDocument(filePath);

      if (symbols.length === 0) {
        debug("  No symbols found");
      } else {
        symbols.forEach((symbol, index) => {
          debug(
            `  ${index + 1}. "${symbol.label}" (line ${symbol.range.start.line + 1})`,
          );
        });
      }
    }

    debug("=== END DEBUG ===\n");
  }

  /**
   * Set up MockMiroClient and return it
   */
  static async setupMockMiroClient(): Promise<MockMiroClient> {
    const testPort = this.getTestPort();
    const serverUrl = `http://localhost:${testPort}`;

    debug(
      `[E2ETestUtils] Setting up MockMiroClient with server URL: ${serverUrl}`,
    );

    this.mockClient = new MockMiroClient(serverUrl);
    await this.mockClient.connect();

    debug("MockMiroClient setup complete");
    return this.mockClient;
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
