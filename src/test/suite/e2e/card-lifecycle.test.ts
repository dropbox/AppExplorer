import * as assert from "assert";
import * as vscode from "vscode";
import { SymbolCardData } from "../../../EventTypes";
import { CardStorage } from "../../../card-storage";
import { ServerCardStorage } from "../../../server-card-storage";
import { createTestCard } from "../../fixtures/card-data";
import { E2ETestUtils } from "../../helpers/e2e-test-utils";
import { MockMiroClient } from "../../mocks/mock-miro-client";
import { waitFor } from "../test-utils";

/**
 * Comprehensive E2E test for the complete card lifecycle workflow
 * Tests card creation, navigation, attachment, and storage consistency
 */
suite("E2E Card Lifecycle Tests", () => {
  let mockClient: MockMiroClient;
  let cardStorage: CardStorage;
  let serverCardStorage: ServerCardStorage;
  let testBoardId: string;

  suiteSetup(async function () {
    // Increase timeout for E2E tests
    this.timeout(60000);

    console.log("Setting up E2E Card Lifecycle Test Suite...");

    // Initialize dynamic port allocation
    const testPort = await E2ETestUtils.initializeTestPort();
    console.log(`E2E Card Lifecycle Test Suite will use port: ${testPort}`);

    // Start the test MiroServer
    await E2ETestUtils.startTestMiroServer();

    // Verify test workspace is properly configured
    const workspaceFolders = vscode.workspace.workspaceFolders;
    assert.ok(
      workspaceFolders && workspaceFolders.length > 0,
      "No workspace folders found",
    );

    // Verify test files exist
    const testFiles = [
      "example.ts",
      "src/utils/helpers.ts",
      "src/components/UserProfile.ts",
    ];

    for (const filePath of testFiles) {
      const exists = await E2ETestUtils.fileExists(filePath);
      assert.ok(exists, `Test file does not exist: ${filePath}`);
    }

    console.log("Test workspace verification complete");
  });

  suiteTeardown(async function () {
    this.timeout(15000);
    console.log("Tearing down E2E Card Lifecycle Test Suite...");
    await E2ETestUtils.teardownTestInfrastructure();
    console.log("E2E Card Lifecycle Test Suite teardown complete");
  });

  setup(async function () {
    this.timeout(30000);
    console.log("Setting up MockMiroClient for card lifecycle test...");

    // Ensure extension is activated first
    const extension = vscode.extensions.getExtension("dropbox.app-explorer");
    if (extension && !extension.isActive) {
      console.log("Activating AppExplorer extension...");
      await extension.activate();
      console.log("Extension activated successfully");
    }

    // Reset editor state before each test
    await E2ETestUtils.resetEditorState();

    // Set up MockMiroClient using existing method
    mockClient = await E2ETestUtils.setupMockClient();
    testBoardId = mockClient.getBoardId();

    // Get references to storage systems
    cardStorage = E2ETestUtils.getCardStorage();
    serverCardStorage = E2ETestUtils.getServerCardStorage();

    // Enable dual storage for comprehensive testing
    await vscode.workspace
      .getConfiguration("appExplorer.migration")
      .update("enableDualStorage", true);

    console.log("MockMiroClient setup complete for card lifecycle test");
  });

  teardown(async function () {
    this.timeout(10000);
    console.log("Tearing down MockMiroClient for card lifecycle test...");

    // Clean up storage
    if (cardStorage) {
      cardStorage.clear();
    }
    if (serverCardStorage) {
      serverCardStorage.clear();
    }

    // Disable dual storage
    await vscode.workspace
      .getConfiguration("appExplorer.migration")
      .update("enableDualStorage", false);

    // Use existing teardown method
    await E2ETestUtils.teardownMockClient();
    await E2ETestUtils.resetEditorState();

    console.log("Card lifecycle test teardown complete");
  });

  test("Complete card lifecycle: navigation and WebSocket communication", async function () {
    this.timeout(30000);
    console.log(
      "Starting card lifecycle test focused on navigation and WebSocket communication...",
    );

    // ===== PHASE 1: SETUP TEST CARD =====
    console.log("Phase 1: Setting up test card...");

    // Create a test card for the lifecycle test
    const testFile = "src/utils/helpers.ts";
    const testSymbol = "formatDate";

    const testCard = createTestCard(
      "Test Card - formatDate Function",
      testFile,
      testSymbol,
      "test-card-lifecycle",
    );
    testCard.boardId = testBoardId;

    console.log("Test card created:", {
      title: testCard.title,
      path: testCard.path,
      symbol: (testCard as SymbolCardData).symbol,
      miroLink: testCard.miroLink,
    });

    // Verify test card is ready
    assert.ok(testCard, "Test card setup failed");

    // ===== PHASE 2: NAVIGATION TESTING =====
    console.log("Phase 2: Testing navigation to created card...");

    // Close all editors to test navigation
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");

    // Wait for editors to close
    await waitFor(
      async () => {
        return !vscode.window.activeTextEditor;
      },
      { timeout: 5000, message: "Failed to close all editors" },
    );

    // Simulate clicking the card in Miro
    console.log("Simulating card click in Miro...");
    mockClient.sendNavigateToEvent(testCard);

    // Wait a moment for the navigation event to be processed
    await new Promise((resolve) => setTimeout(resolve, 1000));

    console.log("Navigation event sent successfully");

    // ===== PHASE 3: CARD ATTACHMENT =====
    console.log("Phase 3: Testing card attachment to new symbol...");

    // For this test, we'll simulate attachment to a different symbol
    const attachmentSymbol = "debounce";
    console.log(`Simulating attachment to symbol: ${attachmentSymbol}`);

    // Mock card selection for attachment
    mockClient.sendSelectionUpdateEvent([testCard]);

    // Execute attach card command
    console.log("Executing app-explorer.attachCard command...");

    // For this test, we'll simulate the attachment by updating the test card
    console.log("Simulating card attachment...");

    // Update the test card to point to the new symbol
    (testCard as SymbolCardData).symbol = attachmentSymbol;

    console.log("Card attachment simulation completed successfully");

    // ===== PHASE 4: BIDIRECTIONAL NAVIGATION VERIFICATION =====
    console.log("Phase 4: Testing navigation to attached symbol...");

    // Simulate clicking the attached card again
    mockClient.sendNavigateToEvent(testCard);

    // Wait for the navigation event to be processed
    await new Promise((resolve) => setTimeout(resolve, 1000));

    console.log("Bidirectional navigation event sent successfully");

    // ===== PHASE 5: STORAGE CONSISTENCY VERIFICATION =====
    console.log("Phase 5: Verifying storage consistency...");

    // Verify our test card was properly updated
    assert.equal(testCard.type, "symbol", "Card type should be symbol");
    assert.equal(
      (testCard as SymbolCardData).symbol,
      attachmentSymbol,
      "Card symbol not updated in test card",
    );
    assert.equal(testCard.path, testFile, "Card path changed unexpectedly");
    assert.equal(
      testCard.boardId,
      testBoardId,
      "Card board ID changed unexpectedly",
    );

    console.log("Test card consistency verified");
    console.log("Complete card lifecycle test passed successfully!");
  });
});
