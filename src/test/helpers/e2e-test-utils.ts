import * as assert from "assert";
import createDebug from "debug";
import invariant from "tiny-invariant";
import * as vscode from "vscode";
import { CardData, SymbolCardData } from "../../EventTypes";
import { LocationFinder } from "../../location-finder";
import { LogPipe } from "../../log-pipe";
import { CHECKPOINT, checkpointRegex } from "../../utils/log-checkpoint";
import { TEST_CARDS } from "../fixtures/card-data";
import { MockMiroClient } from "../mocks/mock-miro-client";
import { waitFor, waitForLog } from "../suite/test-utils";

createDebug.inspectOpts ??= {};
createDebug.inspectOpts.hideDate = true;
let DEBUG = "app-explorer:*";
// DEBUG = "app-explorer:card-storage:*,app-explorer:extension";

createDebug.enable(DEBUG);
const debug = createDebug("app-explorer:test:e2e");

export type LogCapture = {
  dispose: () => void;
  getCapturedLogs: () => string[];
};

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
  static #logPipe: LogPipe | null = null;
  static #logCapture: { getCapturedLogs: () => string[]; dispose: () => void };

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
        debug("[E2ETestUtils] Server failed to start:", error);
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
  static async navigateTo(card: CardData): Promise<void> {
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
    sandbox: { restore: () => void };
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

  static async setupWorkspace() {
    debug("Setting up E2E Navigation Test Suite...");
    await this.enableAllFeatureFlags();
    const [folder, file] =
      (await vscode.commands.executeCommand<[string, string] | null>(
        "app-explorer.internal.logFile",
        DEBUG,
      )) ?? [];
    if (file && folder && !this.#logPipe) {
      this.#logPipe = new LogPipe(folder, file);
      await this.#logPipe.getReader((line) => {
        createDebug.log("[LOG]", line);
      });
    }
    invariant(E2ETestUtils.#logPipe, "LogPipe not initialized");

    // Get test port from environment variable
    const testPort = E2ETestUtils.getTestPort();
    debug(`E2E Test Suite will use port: ${testPort}`);

    waitForLog([CHECKPOINT.start("activate")]);
    waitForLog([CHECKPOINT.done("activate")]);

    // Start the test MiroServer on the allocated port
    await this.startRealServerOnTestPort();

    // Verify test workspace is properly configured
    const workspaceFolders = vscode.workspace.workspaceFolders;
    assert.ok(
      workspaceFolders && workspaceFolders.length === 1,
      "No workspace folders found",
    );

    this.#logCapture?.dispose();
    this.#logCapture = await E2ETestUtils.#logPipe.capture();
  }

  static getCapturedLogs(): string[] {
    return this.#logCapture?.getCapturedLogs() ?? [];
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
      debug(`Error finding symbols in ${relativePath}:`, error);
      return [];
    }
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
    // First, attempt to find an exact match for the symbol name
    let symbol = symbols.find((s) => s.label === symbolName);

    // If no exact match is found, attempt to find a substring match
    if (!symbol) {
      symbol = symbols.find((s) => s.label.includes(symbolName));
    }
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
   * Teardown MockMiroClient
   */
  static async teardownMockMiroClient(): Promise<void> {
    if (this.mockClient) {
      this.mockClient.disconnect();
      this.mockClient = null;
    }
  }

  static async findQuickPickItem(label: string): Promise<string> {
    const seen = new Set<string>();

    // Grab the initial log buffer
    let previousLogs = this.#logCapture.getCapturedLogs();

    debug("findQuickPick", label);
    while (true) {
      // Move to the next QuickPick item
      await vscode.commands.executeCommand(
        "workbench.action.quickOpenSelectNext",
      );

      // Re-read logs and diff out only the new entries
      const allLogs = this.#logCapture.getCapturedLogs();
      const newLogs = allLogs.slice(previousLogs.length);
      previousLogs = allLogs;
      debug("New logs:", newLogs);

      // Extract any selected-item checkpoints from the new logs
      const selections = newLogs
        .map((entry) => {
          // const match = entry.match(checkpointRegex);
          const match = checkpointRegex.exec(entry);
          debug("Found checkpoint:", [...(match ?? [])]);
          return match?.[2];
        })
        .filter((s): s is string => Boolean(s));

      debug("Current selections:", selections);
      if (!selections.length) {
        // no selection log this cycle—just continue
        continue;
      }

      // look at the last one (in case there were multiple)
      const picked = selections[selections.length - 1];

      // if it's our target, accept and return
      if (picked === label) {
        debug("Accepting item", picked);
        await vscode.commands.executeCommand(
          "workbench.action.acceptSelectedQuickOpenItem",
        );
        return picked;
      }

      // if we’ve seen it before, we’ve looped—bail out
      if (seen.has(picked)) {
        throw new Error(
          `QuickPick item "${label}" not found after a full loop.`,
        );
      }

      // otherwise mark it and continue
      seen.add(picked);
    }
  }
}
