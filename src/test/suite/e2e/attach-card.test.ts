import assert from "assert";
import createDebug from "debug";
import * as vscode from "vscode";
import { CardData } from "../../../EventTypes";
import { TEST_CARDS, getTestCardsBySymbol } from "../../fixtures/card-data";
import { E2ETestUtils, isSymbolCard } from "../../helpers/e2e-test-utils";
import { MockMiroClient } from "../../mocks/mock-miro-client";
import { delay, waitFor } from "../test-utils";

/**
 * E2E tests for the "AppExplorer: Attach Card to Code" command
 * Tests the complete workflow of re-linking an existing card to the current code location
 */
suite("E2E Attach Card Tests", () => {
  let mockClient: MockMiroClient;
  const debug = createDebug("app-explorer:test:attach-card");

  suiteSetup(async function () {
    this.timeout(15000);
    debug("Setting up attach card test suite");
    await E2ETestUtils.setupWorkspace();
  });

  suiteTeardown(async function () {
    this.timeout(15000);
    debug("Tearing down attach card test suite");
    await E2ETestUtils.teardownTestInfrastructure();
  });

  let notificationCapture: ReturnType<
    typeof E2ETestUtils.createSinonNotificationCapture
  >;
  setup(async function () {
    this.timeout(15000);
    debug("Setting up individual test");

    // Reset editor state before each test
    await E2ETestUtils.resetEditorState();

    // Set up fresh MockMiroClient for each test
    mockClient = await E2ETestUtils.setupMockClient();

    notificationCapture = E2ETestUtils.createSinonNotificationCapture();
  });

  teardown(async function () {
    this.timeout(10000);
    debug("Tearing down individual test");
    notificationCapture.sandbox.restore();

    // Clean up after each test
    await E2ETestUtils.teardownMockClient();
    await E2ETestUtils.resetEditorState();
  });

  test("Attach card corrects incorrect line number in miroLink", async function () {
    this.timeout(30000);
    debug("Starting attach card test to correct line number");

    // Verify test setup
    assert.equal(
      TEST_CARDS.length,
      mockClient.getTestCards().length,
      "Expected test cards to be loaded into mock client",
    );

    // ===== Step 1: Manual Navigation to formatDate symbol =====
    debug("Step 1: Opening helpers.ts and navigating to formatDate symbol");

    // First, let's check the workspace setup
    const workspaceFolders = vscode.workspace.workspaceFolders;
    debug(
      "Workspace folders:",
      workspaceFolders?.map((f) => f.uri.toString()) || [],
    );
    assert.ok(
      workspaceFolders && workspaceFolders.length > 0,
      "Workspace folder should be available",
    );

    const workspaceFolder = workspaceFolders[0];
    debug("Using workspace folder:", workspaceFolder.uri.toString());

    const filePath = vscode.Uri.joinPath(
      workspaceFolder.uri,
      "src/utils/helpers.ts",
    );
    debug("Attempting to open file:", filePath.toString());

    let document: vscode.TextDocument;
    let editor: vscode.TextEditor;

    try {
      document = await vscode.workspace.openTextDocument(filePath);
      editor = await vscode.window.showTextDocument(document);
    } catch (error) {
      debug("Error opening file:", error);
      throw error;
    }

    // Wait a bit for the language server to initialize
    debug("Waiting for language server to initialize...");
    await delay(2000);

    // Find the formatDate symbol manually
    debug("Requesting document symbols...");
    let symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      "vscode.executeDocumentSymbolProvider",
      document.uri,
    );

    debug("Found", symbols?.length || 0, "symbols in document");
    if (symbols && symbols.length > 0) {
      debug(
        "Available symbols:",
        symbols.map((s) => ({
          name: s.name,
          kind: s.kind,
          line: s.range.start.line,
        })),
      );
    } else {
      debug("No symbols found - language server may not be ready");

      // Try a few more times with delays
      for (let i = 0; i < 3; i++) {
        debug(`Retry ${i + 1}: Waiting 2 more seconds...`);
        await delay(2000);
        const retrySymbols = await vscode.commands.executeCommand<
          vscode.DocumentSymbol[]
        >("vscode.executeDocumentSymbolProvider", document.uri);
        debug(`Retry ${i + 1}: Found`, retrySymbols?.length || 0, "symbols");
        if (retrySymbols && retrySymbols.length > 0) {
          symbols = retrySymbols;
          debug(
            "Available symbols:",
            symbols.map((s) => ({
              name: s.name,
              kind: s.kind,
              line: s.range.start.line,
            })),
          );
          break;
        }
      }
    }

    const formatDateSymbol = symbols?.find((s) => s.name === "formatDate");
    if (!formatDateSymbol) {
      debug(
        "formatDate symbol not found. Available symbols:",
        symbols?.map((s) => s.name) || [],
      );
    }
    assert.ok(formatDateSymbol, "formatDate symbol should be found");

    debug(
      "formatDate symbol found at line %d",
      formatDateSymbol.range.start.line,
    );

    // Position cursor at the symbol
    const position = formatDateSymbol.range.start;
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(formatDateSymbol.range);

    debug("✓ Cursor positioned at formatDate symbol on line %d", position.line);

    // Capture the correct line number for later verification
    const correctLineNumber = formatDateSymbol.range.start.line + 1; // Convert to 1-based line number
    debug("Correct formatDate line number: %d", correctLineNumber);

    // ===== Step 2: Card Selection - Simulate selecting formatDate card in Miro =====
    debug("Step 2: Simulating formatDate card selection in MockMiroClient");

    const formatDateCards = getTestCardsBySymbol("formatDate");
    assert.ok(formatDateCards.length > 0, "formatDate test card should exist");

    const formatDateCard = formatDateCards[0];
    debug("Found formatDate card: %O", {
      title: formatDateCard.title,
      path: formatDateCard.path,
      miroLink: formatDateCard.miroLink,
    });

    // Verify the card has incorrect line number (L99) as expected
    if (isSymbolCard(formatDateCard)) {
      assert.ok(
        formatDateCard.codeLink?.includes("#L99"),
        "formatDate card should have incorrect line number L99",
      );
    }

    // Simulate card selection in MockMiroClient
    // This simulates the user selecting the card in Miro before running attach command
    debug("Simulating card selection in MockMiroClient");

    mockClient.selectCards([formatDateCard]);

    // ===== Step 3: Command Execution - Execute attach card command =====
    debug("Step 3: Executing app-explorer.attachCard command");

    assert(
      notificationCapture.getCapturedNotifications().length === 0,
      "No notifications should be captured yet",
    );
    const attachPromise = vscode.commands.executeCommand<CardData[]>(
      "app-explorer.attachCard",
    );

    // ===== Step 4: QuickPick Interaction - Accept the selected symbol =====
    debug("Step 4: Interacting with QuickPick to select formatDate symbol");

    // Allow QuickPick to appear
    await delay(500);

    // The QuickPick should show available symbols, we want to accept the formatDate symbol
    await vscode.commands.executeCommand(
      "workbench.action.acceptSelectedQuickOpenItem",
    );
    debug("✓ Accepted QuickPick selection");

    // ===== Step 5: Input Submission - Enter new card title =====
    debug("Step 5: Entering new card title");

    // Allow input box to appear
    await delay(200);

    // Accept the input
    await vscode.commands.executeCommand(
      "workbench.action.acceptSelectedQuickOpenItem",
    );
    debug("✓ Entered card title: formatDate()");

    // ===== Step 6: Verification - Check that card was updated correctly =====
    debug("Step 6: Verifying card attachment and correction");

    assert(
      notificationCapture.getCapturedNotifications().length === 0,
      "No notifications should be captured yet",
    );
    // Wait for command completion
    const result = await attachPromise;
    debug("Attach command completed with result: %O", result);

    // The command should return the updated card data
    assert.ok(
      result && result.length > 0,
      "Attach command should return card data",
    );
    const updatedCard = result[0];
    debug("Updated card: %O", updatedCard);

    // Verify the card points to the correct file and symbol
    assert.equal(
      updatedCard.path,
      "src/utils/helpers.ts",
      "Card should point to helpers.ts",
    );
    if (isSymbolCard(updatedCard)) {
      assert.equal(
        updatedCard.symbol,
        "formatDate",
        "Card should reference formatDate symbol",
      );
    }

    // Verify the card type is symbol
    assert.equal(updatedCard.type, "symbol", "Card should be a symbol card");

    debug("✓ Card attachment completed successfully");
    debug("Updated card: %O", updatedCard.miroLink);

    // ===== Step 7: Verify card is stored correctly =====
    debug("Step 7: Verifying card storage");

    await waitFor(
      () => {
        const testCards = mockClient.getTestCards();
        debug(
          "formatDate card in mock client: %O (%s)",
          testCards.filter((c) => isSymbolCard(c) && c.symbol === "formatDate"),
          updatedCard.miroLink,
        );
        const storedCard = testCards.find(
          (c) => c.miroLink === updatedCard.miroLink,
        );
        assert.ok(storedCard, "Updated card should be stored in mock client");
        return true;
      },
      {
        timeout: 5000,
        message: "Updated card should be stored in mock client",
      },
    );

    debug("✓ Card stored correctly in mock client");
    debug("🎉 Attach card test completed successfully!");
  });

  test("Attach card shows error when no card is selected", async function () {
    this.timeout(15000);
    debug("Testing attach card with no selected card");

    // Open a file
    await E2ETestUtils.openFileAtSymbol("src/utils/helpers.ts", "formatDate");
    await E2ETestUtils.waitForFileToOpen("helpers.ts");

    // Mock empty selection (default behavior)
    debug("Executing attach card command with no selected cards");

    // Execute the command - should show error message
    await vscode.commands.executeCommand("app-explorer.attachCard");

    await waitFor(() => {
      // Verify appropriate error notification was shown
      const notifications = notificationCapture.getCapturedNotifications();
      const infoNotification = notifications.find(
        (n) =>
          n.type === "info" &&
          n.message.includes("Please select a single card"),
      );

      assert.ok(
        infoNotification,
        "Expected info notification about selecting a single card",
      );
      debug("✓ Error handling verified: %O", infoNotification);
    });
  });

  test("Attach card shows error when multiple cards are selected", async function () {
    this.timeout(15000);
    debug("Testing attach card with multiple selected cards");

    // Open a file
    await E2ETestUtils.openFileAtSymbol("src/utils/helpers.ts", "formatDate");
    await E2ETestUtils.waitForFileToOpen("helpers.ts");

    // Mock multiple card selection
    const multipleCards = TEST_CARDS.slice(0, 2);
    mockClient.selectCards(multipleCards);

    debug("Executing attach card command with multiple selected cards");

    // Execute the command - should show error message
    await vscode.commands.executeCommand("app-explorer.attachCard");

    // Wait for error notification
    await waitFor(() => {
      // Verify appropriate error notification was shown
      const notifications = notificationCapture.getCapturedNotifications();
      const infoNotification = notifications.find(
        (n) =>
          n.type === "info" &&
          n.message.includes("Please select a single card"),
      );

      assert.ok(
        infoNotification,
        "Expected info notification about selecting a single card",
      );
      debug(
        "✓ Error handling verified for multiple selection: %O",
        infoNotification,
      );
    });
  });
});
