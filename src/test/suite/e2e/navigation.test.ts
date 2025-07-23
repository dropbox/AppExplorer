import * as assert from "assert";
import createDebug from "debug";
import * as vscode from "vscode";
import { SymbolCardData } from "../../../EventTypes";
import { TEST_CARDS } from "../../fixtures/card-data";
import { E2ETestUtils, isSymbolCard } from "../../helpers/e2e-test-utils";
import { MockMiroClient } from "../../mocks/mock-miro-client";
import { delay, waitFor, waitForValue } from "../test-utils";

const debug = createDebug("app-explorer:test:navigation");
createDebug.enable("app-explorer:*");

suite("E2E Navigation Tests", () => {
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

    notificationCapture = E2ETestUtils.createSinonNotificationCapture();
  });

  teardown(async function () {
    this.timeout(10000);

    debug("Tearing down MockMiroClient...");
    notificationCapture?.sandbox.restore();

    // Clean up after each test
    await E2ETestUtils.teardownMockClient();
    await E2ETestUtils.resetEditorState();

    debug("Teardown complete");
  });

  test("Navigating to a card will reconnect it", async function () {
    this.timeout(15000);

    let testCard = TEST_CARDS.find(
      (card) =>
        card.path === "example.ts" &&
        isSymbolCard(card) &&
        card.symbol === "testMethod",
    ) as SymbolCardData;
    testCard = {
      ...testCard,
      status: "disconnected",
    };

    assert.ok(testCard, "Test card for testMethod not found");
    assert.ok(isSymbolCard(testCard), "Test card should be a symbol card");

    await E2ETestUtils.navigateToCard(testCard);
    await E2ETestUtils.waitForFileToOpen("example.ts");

    await waitFor(() => {
      const storedCards = mockClient.getTestCards();
      const storedCard = storedCards.find(
        (c) => c.miroLink === testCard.miroLink,
      );
      assert.equal(storedCard?.status, "connected", "Card status not updated");
    });
  });

  test("Navigating to a nonexistent file will disconnect the card", async function () {
    this.timeout(15000);

    const invalidCard = E2ETestUtils.createInvalidCard("nonexistent-file");

    const numCardsBefore = mockClient.getTestCards().length;
    assert.equal(
      numCardsBefore,
      TEST_CARDS.length,
      "Expected test cards to be loaded into mock client",
    );

    await E2ETestUtils.navigateToCard(invalidCard);
    const numCardsAfter = mockClient.getTestCards().length;
    assert.equal(
      numCardsAfter,
      numCardsBefore + 1,
      "The card should be added to storage",
    );

    debug("Waiting for notifications...");

    // Verify that AppExplorer shows a warning notification
    // Based on browse.ts line 182: vscode.window.showWarningMessage(`Unable to open ${card.path}`)
    const expectedWarning = await waitForValue(
      () => {
        const allNotifications = notificationCapture.getCapturedNotifications();
        return allNotifications.find(
          (n) => n.type === "warning" && n.message.includes(`Unable to open`),
        );
      },
      { timeout: 1000, name: "expectedWarning" },
    );
    assert.ok(expectedWarning, "Expected warning not found");
    assert.ok(
      expectedWarning.message.includes(invalidCard.path),
      "Warning message does not match expected card path",
    );

    debug("Waiting for card status update...");
    const storedCard = await waitForValue(() => {
      const storedCards = mockClient.getTestCards();
      const card = storedCards.find(
        (c) =>
          isSymbolCard(c) &&
          c.symbol === (invalidCard as SymbolCardData).symbol,
      );
      debug("card", card);
      debug("invalidCard", invalidCard);
      return storedCards.find((c) => c.miroLink === invalidCard.miroLink);
    });
    assert.equal(
      storedCard?.status,
      "disconnected",
      "Expected card to be disconnected",
    );
  });

  test("Navigating to a nonexistent symbol will disconnect the card", async function () {
    this.timeout(15000);
    const invalidCard = E2ETestUtils.createInvalidCard("nonexistent-symbol");

    invalidCard.status = "disconnected";

    debug(
      `Testing error handling for nonexistent symbol: ${(invalidCard as SymbolCardData).symbol}`,
    );

    // Simulate navigation to card with invalid symbol
    // For nonexistent symbols, the file should still open (graceful degradation)
    await E2ETestUtils.navigateToCard(invalidCard);

    // Verify file opened correctly (file exists, just symbol doesn't)
    const editor = await E2ETestUtils.waitForFileToOpen(invalidCard.path);

    const relativePath = vscode.workspace.asRelativePath(editor.document.uri);
    assert.ok(
      relativePath.includes("example.ts"),
      `Expected example.ts to be opened, got: ${relativePath}`,
    );

    const storedCard = await waitForValue(() => {
      const storedCards = mockClient.getTestCards();
      return storedCards.find((c) => c.miroLink === invalidCard.miroLink);
    });
    assert.equal(
      storedCard?.status,
      "disconnected",
      "Expected card to be disconnected",
    );
  });

  test("sequential navigation between multiple cards across multiple files", async function () {
    this.timeout(25000);

    // Select 3 different cards for sequential navigation
    const cards = [
      TEST_CARDS.find(
        (card) =>
          card.path === "example.ts" &&
          isSymbolCard(card) &&
          card.symbol === "TestClass",
      ),
      TEST_CARDS.find(
        (card) =>
          card.path === "src/utils/helpers.ts" &&
          isSymbolCard(card) &&
          card.symbol === "debounce",
      ),
      TEST_CARDS.find(
        (card) =>
          card.path === "example.ts" &&
          isSymbolCard(card) &&
          card.symbol === "testFunction",
      ),
    ].filter(Boolean) as SymbolCardData[];

    assert.strictEqual(
      cards.length,
      3,
      "Should have 3 test cards for sequential navigation",
    );

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      debug(`  ${i + 1}. Navigating to ${card.title}...`);

      // Navigate to card
      await E2ETestUtils.navigateToCard(card);

      // Verify correct file and symbol
      const editor = await E2ETestUtils.waitForFileToOpen(card.path);

      const relativePath = vscode.workspace.asRelativePath(editor.document.uri);
      debug("  relativePath", relativePath);
      assert.ok(
        relativePath.includes(card.path.split("/").pop()!),
        `Expected ${card.path} to be opened, got: ${relativePath}`,
      );

      const symbolRange = await E2ETestUtils.findSymbolRange(
        card.symbol,
        editor.document,
      );
      assert.ok(symbolRange, `Symbol ${card.symbol} not found`);
      assert.ok(
        symbolRange.contains(editor.selection.active),
        `Cursor not positioned at ${card.symbol}`,
      );

      // Brief pause between navigations to simulate realistic usage
      await delay(500);
    }

    // Verify all files remain open in editor tabs
    const openEditors = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .map((e) => e.label);
    assert.ok(
      openEditors.length === 2,
      `Expected exactly 2 open tabs, got ${openEditors.join(",")}`,
    );
  });
});
