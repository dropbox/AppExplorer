import createDebug from "debug";
import * as vscode from "vscode";
import { CardData } from "../EventTypes";
import { HandlerContext } from "../extension";
import { TEST_CARDS } from "../test/fixtures/card-data";
import { isSymbolCard } from "../test/helpers/e2e-test-utils";
import { MockMiroClient } from "../test/mocks/mock-miro-client";

const debug = createDebug("app-explorer:debug-mock-client");

/**
 * Register manual debug commands for MockMiroClient
 */
export const registerMockMiroDebugCommands = (
  context: vscode.ExtensionContext,
  mockClient: MockMiroClient,
) => {
  const commands = [
    // Command to show card list and simulate opening a card
    vscode.commands.registerCommand(
      "app-explorer.mockMiro.showCardList",
      async () => {
        const cards = mockClient.getTestCards();
        if (cards.length === 0) {
          vscode.window.showWarningMessage(
            "MockMiroClient: No test cards loaded",
          );
          return;
        }

        const quickPickItems = cards.map((card) => ({
          label: card.title,
          description: `${card.path} → ${isSymbolCard(card) ? card.symbol : "Group"}`,
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

    // Command to simulate opening a specific card
    vscode.commands.registerCommand(
      "app-explorer.mockMiro.simulateCardOpen",
      async (card?: CardData) => {
        if (!card) {
          vscode.window.showErrorMessage("No card provided for simulation");
          return;
        }

        if (!mockClient.isConnected) {
          vscode.window.showErrorMessage(
            "MockMiroClient: Not connected to server. Run 'Launch Mock Miro Client' first.",
          );
          return;
        }

        // Send WebSocket event to local server (same format as real Miro)
        mockClient.sendNavigateToEvent(card);

        vscode.window.showInformationMessage(
          `MockMiroClient: Simulated opening card "${card.title}" → ${card.path}:${isSymbolCard(card) ? card.symbol : "Group"}`,
        );

        debug("MockMiroClient: Sent navigateTo event", {
          cardTitle: card.title,
          path: card.path,
          symbol: isSymbolCard(card) ? card.symbol : undefined,
          miroLink: card.miroLink,
          timestamp: new Date().toISOString(),
        });
      },
    ),

    // Command to simulate selecting multiple cards
    vscode.commands.registerCommand(
      "app-explorer.mockMiro.simulateCardSelection",
      async () => {
        const cards = mockClient.getTestCards();
        if (cards.length === 0) {
          vscode.window.showWarningMessage(
            "MockMiroClient: No test cards loaded",
          );
          return;
        }

        if (!mockClient.isConnected) {
          vscode.window.showErrorMessage(
            "MockMiroClient: Not connected to server. Run 'Launch Mock Miro Client' first.",
          );
          return;
        }

        const quickPickItems = cards.map((card) => ({
          label: card.title,
          description: `${card.path} → ${isSymbolCard(card) ? card.symbol : "Group"}`,
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

          debug("MockMiroClient: Sent selection update event", {
            cardCount: selectedCards.length,
            cards: selectedCards.map((c) => ({ title: c.title, path: c.path })),
            timestamp: new Date().toISOString(),
          });
        }
      },
    ),

    // Command to simulate card update
    vscode.commands.registerCommand(
      "app-explorer.mockMiro.simulateCardUpdate",
      async () => {
        const cards = mockClient.getTestCards();
        if (cards.length === 0) {
          vscode.window.showWarningMessage(
            "MockMiroClient: No test cards loaded",
          );
          return;
        }

        if (!mockClient.isConnected) {
          vscode.window.showErrorMessage(
            "MockMiroClient: Not connected to server. Run 'Launch Mock Miro Client' first.",
          );
          return;
        }

        const quickPickItems = cards.map((card) => ({
          label: card.title,
          description: `${card.path} → ${isSymbolCard(card) ? card.symbol : "Group"}`,
          detail: `Current status: ${card.status}`,
          card: card,
        }));

        const selected = await vscode.window.showQuickPick(quickPickItems, {
          placeHolder: "Select a card to simulate update",
          matchOnDescription: true,
          matchOnDetail: true,
        });

        if (selected) {
          // Toggle status for demonstration
          const updatedCard = {
            ...selected.card,
            status:
              selected.card.status === "connected"
                ? "disconnected"
                : "connected",
          } as CardData;

          mockClient.sendCardUpdateEvent(updatedCard);

          vscode.window.showInformationMessage(
            `MockMiroClient: Simulated updating card "${updatedCard.title}" status to ${updatedCard.status}`,
          );

          debug("MockMiroClient: Sent card update event", {
            cardTitle: updatedCard.title,
            oldStatus: selected.card.status,
            newStatus: updatedCard.status,
            miroLink: updatedCard.miroLink,
            timestamp: new Date().toISOString(),
          });
        }
      },
    ),

    // Command to show MockMiroClient status
    vscode.commands.registerCommand(
      "app-explorer.mockMiro.showStatus",
      async () => {
        const status = mockClient.isConnected ? "Connected" : "Disconnected";
        const cardCount = mockClient.getTestCards().length;
        const boardInfo = mockClient.boardInfo;

        const statusMessage = `
MockMiroClient Status:
• Connection: ${status}
• Board: ${boardInfo.name} (${boardInfo.id})
• Test Cards: ${cardCount}
        `.trim();

        vscode.window.showInformationMessage(statusMessage);

        debug("MockMiroClient Status", {
          connected: mockClient.isConnected,
          boardId: boardInfo.id,
          boardName: boardInfo.name,
          cardCount,
          timestamp: new Date().toISOString(),
        });
      },
    ),
  ];

  context.subscriptions.push(...commands);
};

/**
 * Main debug command handler that launches MockMiroClient
 */
export const makeDebugMockClientHandler = (
  _context: HandlerContext,
  extensionContext: vscode.ExtensionContext,
) => {
  return async () => {
    try {
      // Clear any existing context state
      await vscode.commands.executeCommand(
        "setContext",
        "mockMiroClient.connected",
        false,
      );

      const mockClient = new MockMiroClient();

      // Load test card fixtures
      mockClient.loadTestCards(TEST_CARDS);

      // Connect to local server
      await mockClient.connect();

      // Register manual debug commands
      registerMockMiroDebugCommands(extensionContext, mockClient);

      // Store reference for cleanup
      extensionContext.subscriptions.push({
        dispose: () => {
          mockClient.disconnect();
        },
      });

      vscode.window.showInformationMessage(
        `MockMiroClient connected as board "${mockClient.boardInfo.name}" with ${TEST_CARDS.length} test cards. Use "MockMiro: Show Card List" command to simulate events.`,
      );

      debug("MockMiroClient launched successfully", {
        boardId: mockClient.boardInfo.id,
        boardName: mockClient.boardInfo.name,
        cardCount: TEST_CARDS.length,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(
        `Failed to launch MockMiroClient: ${errorMessage}`,
      );
      debug("MockMiroClient launch failed", {
        error: errorMessage,
        timestamp: new Date().toISOString(),
      });
    }
  };
};
