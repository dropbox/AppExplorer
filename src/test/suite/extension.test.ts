import * as assert from "assert";
import { getDefaultStore } from "jotai/vanilla";
import * as vscode from "vscode";
import {
  activeBoardsConnectionsAtom,
  allCardsAtom,
  baseStorageAtom,
  BoardInfo,
  contextAtom,
  getBoardIdFromMiroLink,
  numConnectionsAtom,
  workspaceBoardsAtom,
} from "../../card-storage";
import { CardData } from "../../EventTypes";
import { getGitHubUrl } from "../../get-github-url";
import { getRelativePath } from "../../get-relative-path";
import { GitUtils } from "../../git-utils";
import { LocationFinder } from "../../location-finder";
import { setTestName, uriForFile, waitFor } from "./test-utils";

console.log("Running tests...");
suite("Card Storage Tests", () => {
  let store: ReturnType<typeof getDefaultStore>;
  let mockContext: Partial<vscode.ExtensionContext>;

  setup(() => {
    console.log("Setting up tests...");
    store = getDefaultStore();

    mockContext = {
      workspaceState: {
        keys: () => ["board-filter"],
        get: (key: string) => {
          if (key === "board-filter") {
            return undefined;
          }
          return undefined;
        },
        update: (_key: string, _value: any) => {
          return Promise.resolve();
        },
      } as vscode.Memento,
    };
    store.set(contextAtom, mockContext as vscode.ExtensionContext);
  });

  test("getBoardIdFromMiroLink returns board ID for valid link", () => {
    console.log("Testing getBoardIdFromMiroLink...");
    const link = "https://miro.com/app/board/o9xxxxxxxxx=/";
    const boardId = getBoardIdFromMiroLink(link);
    assert.strictEqual(boardId, "o9xxxxxxxxx=");
  });

  test("getBoardIdFromMiroLink returns undefined for invalid link", () => {
    const link = "invalid-link";
    const boardId = getBoardIdFromMiroLink(link);
    assert.strictEqual(boardId, undefined);
  });

  test("workspaceBoardsAtom returns empty array when no boards are stored", () => {
    const boards = store.get(workspaceBoardsAtom);
    assert.deepStrictEqual(boards, []);
  });

  test("workspaceBoardsAtom updates workspaceState", async () => {
    let updatedValue: any;
    mockContext.workspaceState!.update = (_key: string, value: any) => {
      updatedValue = value;
      return Promise.resolve();
    };

    const boardIds = ["board1", "board2"];
    store.set(workspaceBoardsAtom, boardIds);
    assert.deepStrictEqual(updatedValue, boardIds);
  });

  test("baseStorageAtom returns empty array when no boards are stored", () => {
    const boards = store.get(baseStorageAtom);
    assert.deepStrictEqual(boards, []);
  });

  test("activeBoardsConnectionsAtom returns empty array initially", () => {
    const connections = store.get(activeBoardsConnectionsAtom);
    assert.deepStrictEqual(connections, []);
  });

  test("activeBoardsConnectionsAtom updates numConnectionsAtom", () => {
    store.set(activeBoardsConnectionsAtom, ["board1"]);
    const numConnections = store.get(numConnectionsAtom);
    assert.strictEqual(numConnections, 1);
  });

  test("allCardsAtom returns empty array when no boards are connected", () => {
    const allCards = store.get(allCardsAtom);
    assert.deepStrictEqual(allCards, []);
  });

  test("allCardsAtom returns all cards when multiple boards are connected", () => {
    const card1: CardData = {
      boardId: "board1",
      type: "symbol",
      title: "Card 1",
      path: "path1",
      symbol: "symbol1",
      miroLink: "link1",
      codeLink: null,
      status: "connected",
    };
    const card2: CardData = {
      boardId: "board2",
      type: "symbol",
      title: "Card 2",
      path: "path2",
      symbol: "symbol2",
      miroLink: "link2",
      codeLink: null,
      status: "connected",
    };

    const baseStorage: BoardInfo[] = [
      {
        name: "Board 1",
        id: "board1",
        cards: { link1: card1 },
      },
      {
        name: "Board 2",
        id: "board2",
        cards: { link2: card2 },
      },
    ];
    store.set(baseStorageAtom, baseStorage);

    const allCards = store.get(allCardsAtom);
    assert.deepStrictEqual(allCards, [card1, card2]);
  });
  // });
  // suite("AppExplorer Tests", () => {
  let locationFinder: LocationFinder;
  let exampleUri: vscode.Uri;

  setup(async function () {
    try {
      setTestName(this.test?.title ?? "unknown");
      locationFinder = new LocationFinder();
      exampleUri = await uriForFile("example.ts");
    } catch (e) {
      // console.error("Error initializing LocationFinder:", e);
      throw e;
    }
  });

  test("finds symbols in document", async () => {
    const symbols = await waitFor(async () => {
      const symbols = await locationFinder.findSymbolsInDocument(exampleUri);
      assert.ok(symbols.length > 0, "No symbols found");
      return symbols;
    });
    assert.ok(symbols.some((s) => s.label === "TestClass"));
  });

  test("finds symbol at position", async () => {
    const document = await vscode.workspace.openTextDocument(exampleUri);
    const position = new vscode.Position(1, 15); // Inside TestClass constructor

    const symbol = await waitFor(async () => {
      const symbol = await locationFinder.findSymbolInPosition(
        document.uri,
        position,
      );
      assert.ok(symbol, "No symbol found at the specified position");
      return symbol;
    });
    assert.strictEqual(symbol.label, "TestClass/constructor");
  });

  test("resolves path within workspace root", () => {
    assert.strictEqual(getRelativePath(exampleUri), "example.ts");
  });

  class MockGitUtils implements GitUtils {
    async getCurrentHash(): Promise<string | null> {
      return "abcd1234";
    }

    async getRemotes(): Promise<string[]> {
      return ["origin", "upstream"];
    }

    async getRemoteUrl(): Promise<string | null> {
      return "git@github.com:testowner/testrepo.git";
    }
  }
  const mockGitUtils = new MockGitUtils();

  test("generates correct GitHub URL for single line", async () => {
    const locationLink: vscode.LocationLink = {
      targetUri: exampleUri,
      targetRange: new vscode.Range(9, 0, 9, 0),
      targetSelectionRange: new vscode.Range(9, 0, 9, 0),
    };

    const url = await getGitHubUrl(locationLink, mockGitUtils);
    assert.strictEqual(
      url,
      "https://github.com/testowner/testrepo/blob/abcd1234/example.ts#L10",
    );
  });

  test("generates correct GitHub URL for multiple lines", async () => {
    const locationLink: vscode.LocationLink = {
      targetUri: exampleUri,
      targetRange: new vscode.Range(9, 0, 12, 0),
      targetSelectionRange: new vscode.Range(9, 0, 12, 0),
    };

    const url = await getGitHubUrl(locationLink, mockGitUtils);
    assert.strictEqual(
      url,
      "https://github.com/testowner/testrepo/blob/abcd1234/example.ts#L10-L13",
    );
  });

  test("returns null when git commands fail", async () => {
    const failingGitUtils: GitUtils = {
      async getCurrentHash(): Promise<string | null> {
        return null;
      },
      async getRemotes(): Promise<string[]> {
        return [];
      },
      async getRemoteUrl(): Promise<string | null> {
        return null;
      },
    };

    const locationLink: vscode.LocationLink = {
      targetUri: exampleUri,
      targetRange: new vscode.Range(0, 0, 0, 0),
      targetSelectionRange: new vscode.Range(0, 0, 0, 0),
    };

    const url = await getGitHubUrl(locationLink, failingGitUtils);
    assert.strictEqual(url, null);
  });
});
