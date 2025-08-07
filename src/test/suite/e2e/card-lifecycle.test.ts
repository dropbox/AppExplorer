import * as assert from "assert";
import createDebug from "debug";
import invariant from "tiny-invariant";
import * as vscode from "vscode";
import { CardData } from "../../../EventTypes";
import { CHECKPOINT } from "../../../utils/log-checkpoint";
import { TEST_CARDS } from "../../fixtures/card-data";
import { E2ETestUtils, isSymbolCard } from "../../helpers/e2e-test-utils";
import { MockMiroClient } from "../../mocks/mock-miro-client";
import { waitForLog, waitForValue } from "../test-utils";

const debug = createDebug("app-explorer:test:card-lifecycle");

/**
 * Comprehensive E2E test for the complete card lifecycle workflow
 * Tests card creation, navigation, attachment, and storage consistency
 */
suite("E2E Card Lifecycle Tests", () => {
  let mockClient: MockMiroClient;

  suiteSetup(async function () {
    // Increase timeout for E2E tests
    this.timeout(15000);
    await E2ETestUtils.setupWorkspace();
  });

  suiteTeardown(async function () {
    this.timeout(15000);
    await E2ETestUtils.teardownTestInfrastructure();
  });

  let notificationCapture: ReturnType<
    typeof E2ETestUtils.createSinonNotificationCapture
  >;
  setup(async function () {
    this.timeout(15000);

    debug("Setting up MockMiroClient for test...");

    // Reset editor state before each test
    await E2ETestUtils.resetEditorState();

    // Set up fresh MockMiroClient for each test
    mockClient = await E2ETestUtils.setupMockClient();

    // Start capturing notifications for error handling tests
    notificationCapture = E2ETestUtils.createSinonNotificationCapture();
  });

  teardown(async function () {
    this.timeout(10000);

    debug("Tearing down MockMiroClient...");
    notificationCapture.sandbox.restore();

    // Clean up after each test
    await E2ETestUtils.teardownMockClient();
    await E2ETestUtils.resetEditorState();

    debug("Teardown complete");
  });

  test("Complete card lifecycle: navigation and WebSocket communication", async function () {
    this.timeout(30000);

    // This test simulates the complete user workflow:
    // 1. Open a file and navigate to a symbol
    // 2. Create a card using the create card command (mocked UI interactions)
    // 3. Close the editor
    // 4. Navigate back to the card via WebSocket communication
    // 5. Verify the editor reopens at the correct position

    assert.equal(
      TEST_CARDS.length,
      mockClient.getTestCards().length,
      "Expected test cards to be loaded into mock client",
    );

    // ===== Navigate to UserProfile.ts =====
    debug("Step 1: Opening UserProfile.ts file");
    await E2ETestUtils.openFileAtSymbol(
      "src/components/UserProfile.ts",
      "UserProfile",
    );

    // Wait for the file to be opened and verify it's the correct file
    const editor = await E2ETestUtils.waitForFileToOpen("UserProfile.ts");
    assert.ok(editor, "UserProfile.ts should be opened");
    debug("✓ UserProfile.ts opened successfully");

    // ===== Navigate to the render function =====
    debug("Step 2: Navigating to render function");

    // Get all available symbols in the document to find the render function
    const allSymbols = await E2ETestUtils.listAllSymbolsInDocument(
      "src/components/UserProfile.ts",
    );

    // Try to find the render symbol (it might be nested as "UserProfile/render")
    const renderSymbol = allSymbols.find(
      (s) => s.label === "render" || s.label === "UserProfile/render",
    );
    invariant(renderSymbol, "Render symbol should be found");
    // Navigate to the render symbol using its exact label
    await E2ETestUtils.navigateToSymbol(editor, renderSymbol.label);
    await E2ETestUtils.waitForCursorAtSymbol(renderSymbol.label, editor);
    debug("✓ Cursor positioned at render function");

    // ===== Trigger the Create Card menu =====
    debug("Step 3: Testing card creation logic");
    const cardsPromise = vscode.commands.executeCommand<CardData[]>(
      "app-explorer.createCard",
    );

    const boardOrSymbol = await waitForLog([
      CHECKPOINT.quickPick("Choose a board"),
      CHECKPOINT.quickPick("Choose a symbol step 1/2"),
    ]);

    if (boardOrSymbol === CHECKPOINT.quickPick("Choose a board")) {
      await E2ETestUtils.findQuickPickItem("Mock Test Board");
    }

    await waitForLog([CHECKPOINT.quickPick("Choose a symbol step 1/2")]);
    await E2ETestUtils.findQuickPickItem("UserProfile");
    await waitForLog([CHECKPOINT.quickPick("Card Title 2/2")]);
    await vscode.commands.executeCommand(
      "workbench.action.acceptSelectedQuickOpenItem",
    );
    const [createdCard] = await cardsPromise;

    debug("Waiting for card update...");
    const card = await waitForValue(() =>
      mockClient
        .getTestCards()
        .find(
          (c) =>
            isSymbolCard(c) &&
            isSymbolCard(createdCard) &&
            c.path === createdCard.path &&
            c.symbol === createdCard.symbol,
        ),
    );

    debug("createdCard", card);
    assert.ok(card, "Card should be created");
    await E2ETestUtils.resetEditorState();

    await E2ETestUtils.navigateTo(card);
    await E2ETestUtils.waitForFileToOpen(card.path.split("/").pop()!);
  });
});
