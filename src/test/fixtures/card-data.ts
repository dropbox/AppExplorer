import { CardData, SymbolCardData } from "../../EventTypes";

/**
 * Type guard to check if a card is a symbol card
 */
function isSymbolCard(card: CardData): card is SymbolCardData {
  return card.type === "symbol";
}

/**
 * Test card fixtures that reference actual symbols in the sample-workspace
 * All cards use the MockMiroClient board ID for consistency
 */
export const TEST_CARDS: CardData[] = [
  // Use symbols that we know work from the debug output
  {
    boardId: "mock-board-test-123",
    type: "symbol",
    title: "TestClass",
    path: "example.ts",
    symbol: "TestClass",
    miroLink: "https://miro.com/app/board/mock-board-test-123/card1",
    codeLink: "https://github.com/test/repo/blob/main/example.ts#L1",
    status: "connected",
  },
  {
    boardId: "mock-board-test-123",
    type: "symbol",
    title: "TestClass.testMethod",
    path: "example.ts",
    symbol: "testMethod",
    miroLink: "https://miro.com/app/board/mock-board-test-123/card2",
    codeLink: "https://github.com/test/repo/blob/main/example.ts#L3",
    status: "connected",
  },
  {
    boardId: "mock-board-test-123",
    type: "symbol",
    title: "testFunction",
    path: "example.ts",
    symbol: "testFunction",
    miroLink: "https://miro.com/app/board/mock-board-test-123/card3",
    codeLink: "https://github.com/test/repo/blob/main/example.ts#L5",
    status: "connected",
  },
  {
    boardId: "mock-board-test-123",
    type: "symbol",
    title: "formatDate",
    path: "src/utils/helpers.ts",
    symbol: "formatDate",
    miroLink: "https://miro.com/app/board/mock-board-test-123/card5",
    // This has been intentionally changed to point to the wrong line number
    codeLink:
      "https://github.com/asa-codelabs/AppExplorer/blob/main/sample-workspace/src/utils/helpers.ts#L99",
    status: "connected",
  },
  {
    boardId: "mock-board-test-123",
    type: "symbol",
    title: "debounce",
    path: "src/utils/helpers.ts",
    symbol: "debounce",
    miroLink: "https://miro.com/app/board/mock-board-test-123/card6",
    codeLink:
      "https://github.com/asa-codelabs/AppExplorer/blob/main/sample-workspace/src/utils/helpers.ts#L17",
    status: "connected",
  },
  {
    boardId: "mock-board-test-123",
    type: "symbol",
    title: "TestClass.testMethod",
    path: "example.ts",
    symbol: "testMethod",
    miroLink: "https://miro.com/app/board/mock-board-test-123/card7",
    codeLink:
      "https://github.com/asa-codelabs/AppExplorer/blob/main/example.ts#L3",
    status: "disconnected",
  },
  {
    boardId: "mock-board-test-123",
    type: "symbol",
    title: "testFunction",
    path: "example.ts",
    symbol: "testFunction",
    miroLink: "https://miro.com/app/board/mock-board-test-123/card8",
    codeLink:
      "https://github.com/asa-codelabs/AppExplorer/blob/main/example.ts#L5",
    status: "disconnected",
  },
];

/**
 * Get test cards filtered by file path
 */
export function getTestCardsByPath(path: string): CardData[] {
  return TEST_CARDS.filter((card) => card.path === path);
}

/**
 * Get a test card by its miro link
 */
export function getTestCardByMiroLink(miroLink: string): CardData | undefined {
  return TEST_CARDS.find((card) => card.miroLink === miroLink);
}

/**
 * Get test cards filtered by symbol name
 */
export function getTestCardsBySymbol(symbol: string): CardData[] {
  return TEST_CARDS.filter(
    (card) => card.type === "symbol" && card.symbol === symbol,
  );
}

/**
 * Create a new test card with the mock board ID
 */
export function createTestCard(
  title: string,
  path: string,
  symbol: string,
  cardId?: string,
): CardData {
  const id = cardId || `card${Date.now()}`;
  return {
    boardId: "mock-board-test-123",
    type: "symbol",
    title,
    path,
    symbol,
    miroLink: `https://miro.com/app/board/mock-board-test-123/${id}`,
    codeLink: `https://github.com/test/repo/blob/main/${path}#L1`,
    status: "connected",
  };
}
