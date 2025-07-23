import * as assert from "assert";
import * as vscode from "vscode";
import { CardData, SymbolCardData } from "../../EventTypes";
import { LocationFinder } from "../../location-finder";
import { MockMiroClient } from "../mocks/mock-miro-client";
import { waitFor } from "../suite/test-utils";

/**
 * Verification helpers for E2E tests
 */
export class E2EVerificationHelper {
  private static locationFinder = new LocationFinder();

  /**
   * Verify that a file opened correctly
   */
  static async verifyFileOpened(
    expectedPath: string,
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
        timeout: 10000,
        message: `File "${expectedPath}" did not open correctly`,
      },
    );
  }

  /**
   * Verify cursor position at a specific symbol
   */
  static async verifyCursorPosition(
    expectedSymbol: string,
    editor: vscode.TextEditor,
  ): Promise<vscode.Position> {
    return waitFor(
      async () => {
        const symbols = await this.locationFinder.findSymbolsInDocument(
          editor.document.uri,
        );
        const symbol = symbols.find((s) => s.label === expectedSymbol);
        assert.ok(symbol, `Symbol "${expectedSymbol}" not found in document`);

        const cursorPosition = editor.selection.active;
        assert.ok(
          symbol.range.contains(cursorPosition),
          `Cursor not positioned at symbol "${expectedSymbol}". Expected within ${symbol.range.start.line}-${symbol.range.end.line}, got line ${cursorPosition.line}`,
        );

        return cursorPosition;
      },
      {
        timeout: 5000,
        message: `Cursor not positioned at symbol "${expectedSymbol}"`,
      },
    );
  }

  /**
   * Verify card storage state
   */
  static async verifyCardStorageState(
    expectedCards: CardData[],
    mockClient: MockMiroClient,
  ): Promise<void> {
    await waitFor(
      () => {
        const storedCards = mockClient.getTestCards();

        for (const expectedCard of expectedCards) {
          const storedCard = storedCards.find(
            (c) => c.miroLink === expectedCard.miroLink,
          );
          assert.ok(
            storedCard,
            `Card with miroLink "${expectedCard.miroLink}" not found in storage`,
          );

          assert.strictEqual(
            storedCard.title,
            expectedCard.title,
            `Card title mismatch for ${expectedCard.miroLink}`,
          );

          assert.strictEqual(
            storedCard.path,
            expectedCard.path,
            `Card path mismatch for ${expectedCard.miroLink}`,
          );

          if (expectedCard.type === "symbol" && storedCard.type === "symbol") {
            assert.strictEqual(
              storedCard.symbol,
              expectedCard.symbol,
              `Card symbol mismatch for ${expectedCard.miroLink}`,
            );
          }
        }

        return true;
      },
      { timeout: 5000, message: "Card storage state verification failed" },
    );
  }

  /**
   * Verify no memory leaks by checking basic metrics
   */
  static async verifyNoMemoryLeaks(): Promise<void> {
    // Basic memory leak detection
    if (global.gc) {
      global.gc();
    }

    const memUsage = process.memoryUsage();
    const maxHeapUsed = 100 * 1024 * 1024; // 100MB threshold

    assert.ok(
      memUsage.heapUsed < maxHeapUsed,
      `Memory usage too high: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB (max: ${Math.round(maxHeapUsed / 1024 / 1024)}MB)`,
    );
  }

  /**
   * Capture performance metrics
   */
  static async capturePerformanceMetrics(): Promise<PerformanceMetrics> {
    const memUsage = process.memoryUsage();

    return {
      timestamp: Date.now(),
      memoryUsage: {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        external: memUsage.external,
        rss: memUsage.rss,
      },
      openEditors: vscode.window.tabGroups.all.flatMap((group) => group.tabs)
        .length,
    };
  }

  /**
   * Verify VSCode editor state is clean
   */
  static async verifyCleanEditorState(): Promise<void> {
    // Check that no unexpected editors are open
    const openTabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs);

    // Allow some reasonable number of open tabs (tests may legitimately open files)
    assert.ok(
      openTabs.length < 10,
      `Too many open tabs: ${openTabs.length} (expected < 10)`,
    );
  }

  /**
   * Verify symbol exists in document
   */
  static async verifySymbolExists(
    symbolName: string,
    documentUri: vscode.Uri,
  ): Promise<boolean> {
    try {
      const symbols =
        await this.locationFinder.findSymbolsInDocument(documentUri);
      return symbols.some((s) => s.label === symbolName);
    } catch {
      return false;
    }
  }

  /**
   * Verify navigation completed successfully
   */
  static async verifyNavigationSuccess(
    card: CardData,
    _timeoutMs: number = 15000,
  ): Promise<{ editor: vscode.TextEditor; position?: vscode.Position }> {
    // Wait for file to open
    const editor = await this.verifyFileOpened(card.path);

    let position: vscode.Position | undefined;

    // If it's a symbol card, verify cursor positioning
    if (card.type === "symbol") {
      const symbolCard = card as SymbolCardData;
      position = await this.verifyCursorPosition(symbolCard.symbol, editor);
    }

    return { editor, position };
  }

  /**
   * Verify error handling doesn't crash the extension
   */
  static async verifyErrorHandling(
    operation: () => Promise<void> | void,
    expectedBehavior: "no-crash" | "graceful-failure" = "no-crash",
  ): Promise<void> {
    const initialEditorCount = vscode.window.tabGroups.all.flatMap(
      (group) => group.tabs,
    ).length;

    try {
      await operation();

      // Verify extension is still responsive
      await vscode.commands.executeCommand("workbench.action.showCommands");

      if (expectedBehavior === "graceful-failure") {
        // For graceful failure, we expect the operation to complete without throwing
        // but may not achieve its intended effect
      }
    } catch (error) {
      if (expectedBehavior === "no-crash") {
        throw new Error(
          `Operation crashed when it should have handled error gracefully: ${error}`,
        );
      }
    }

    // Verify no unexpected side effects
    const finalEditorCount = vscode.window.tabGroups.all.flatMap(
      (group) => group.tabs,
    ).length;
    assert.ok(
      Math.abs(finalEditorCount - initialEditorCount) <= 1,
      `Unexpected change in editor count: ${initialEditorCount} -> ${finalEditorCount}`,
    );
  }

  /**
   * Wait for MockMiroClient to be in expected state
   */
  static async verifyMockClientState(
    mockClient: MockMiroClient,
    expectedConnected: boolean,
    timeoutMs: number = 5000,
  ): Promise<void> {
    await waitFor(
      () => {
        assert.strictEqual(
          mockClient.isConnected,
          expectedConnected,
          `MockMiroClient connection state mismatch. Expected: ${expectedConnected}, Actual: ${mockClient.isConnected}`,
        );
        return true;
      },
      {
        timeout: timeoutMs,
        message: `MockMiroClient state verification failed`,
      },
    );
  }
}

/**
 * Performance metrics interface
 */
export interface PerformanceMetrics {
  timestamp: number;
  memoryUsage: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
  openEditors: number;
}
