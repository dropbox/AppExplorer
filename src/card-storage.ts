import { Atom, atom, getDefaultStore, WritableAtom } from "jotai/vanilla";
import {
  atomWithRefresh,
  atomWithStorage,
  splitAtom,
} from "jotai/vanilla/utils";
import { SyncStorage } from "jotai/vanilla/utils/atomWithStorage";
import * as vscode from "vscode";
import { CardData } from "./EventTypes";

export type BoardInfo = {
  id: string;
  name: string;
  cards: Record<NonNullable<CardData["miroLink"]>, CardData>;
};

type StorageEvent =
  | { type: "workspaceBoards"; boardIds: string[] }
  | { type: "boardUpdate"; board: BoardInfo | null; boardId: BoardInfo["id"] }
  | { type: "connectedBoards"; boards: string[] }
  | {
      type: "cardUpdate";
      miroLink: CardData["miroLink"];
      card: CardData | null;
    };

export const contextAtom = atom<vscode.ExtensionContext | null>(null);

const _workspaceBaordsAtom = atomWithRefresh<string[]>((get) => {
  const context = get(contextAtom);
  if (!context) {
    return [];
  }
  return (context.workspaceState.get(`board-filter`) as string[]) ?? [];
});

export const workspaceBoardsAtom = atom(
  (get) => {
    return get(_workspaceBaordsAtom);
  },
  (get, set, boardIds: string[]) => {
    const context = get(contextAtom);
    if (!context) {
      return;
    }
    if (boardIds.length === 0) {
      context.workspaceState.update(`board-filter`, undefined);
    } else {
      context.workspaceState.update(`board-filter`, boardIds);
    }
    set(_workspaceBaordsAtom);
  },
);

const workspaceStorage: SyncStorage<any> = {
  removeItem: (key) => {
    const context = store.get(contextAtom);
    if (context) {
      context.workspaceState.update(key, undefined);
    }
  },
  getItem: (key) => {
    const context = store.get(contextAtom);
    if (context) {
      return context.workspaceState.get<string[]>(key) ?? [];
    }
    return [];
  },
  setItem: (key, value) => {
    const context = store.get(contextAtom);
    if (!context) {
      return;
    }
    context.workspaceState.update(key, value);
  },
};

const boardIdsAtom = atomWithStorage<string[]>(
  "boardIds",
  [],
  workspaceStorage,
);
const splitBoards = splitAtom(boardIdsAtom);
const storageBoardAtoms = mapSplitAtom(splitBoards, (boardId) => {
  const result = atomWithStorage<BoardInfo>(
    `board-${boardId}`,
    {
      id: boardId,
      name: boardId,
      cards: {},
    },
    workspaceStorage,
  );
  return result;
});

function mapSplitAtom<T, A extends Atom<any>>(
  collectionAtom: WritableAtom<Atom<T>[], any, any>,
  transform: (value: T) => A,
): Atom<A[]> {
  const map = new WeakMap<Atom<T>, A>();
  const result = atom((get) => {
    const value = get(collectionAtom);
    return value.map((t) => {
      if (!map.has(t)) {
        const newAtom = transform(get(t));
        map.set(t, newAtom);
      }
      return map.get(t)!;
    });
  });
  return result;
}

export const baseStorageAtom = atom(
  (get) => {
    return get(storageBoardAtoms);
  },
  (get, set, boardInfo: BoardInfo[]) => {
    set(
      boardIdsAtom,
      boardInfo.map((b) => b.id),
    );
    get(storageBoardAtoms).forEach((boardAtom) => {
      const board = get(boardAtom);
      const newData = boardInfo.find((b) => b.id === board.id);
      if (newData) {
        set(boardAtom, newData);
      }
    });
  },
);

export const storageAtom = baseStorageAtom;

export const cardNavigationAtom = atom(null as null | CardData);

export const activeBoardsConnectionsAtom = atom([] as string[]);

export const numConnectionsAtom = atom(
  (get) => get(activeBoardsConnectionsAtom).length,
);
export const allCardsAtom = atom((get) =>
  get(storageAtom).reduce((acc, b) => {
    const board = get(b);
    const cardList = Object.values(board.cards);
    return acc.concat(cardList);
  }, [] as CardData[]),
);

const store = getDefaultStore();

export class CardStorage extends vscode.EventEmitter<StorageEvent> {
  constructor(private context: vscode.ExtensionContext) {
    super();
    store.set(contextAtom, context);
    this.context.subscriptions.push(this);
  }

  getConnectedBoards() {
    return store.get(activeBoardsConnectionsAtom);
  }

  async connectBoard(boardId: string) {
    store.set(activeBoardsConnectionsAtom, (p) => p.concat(boardId));
  }

  async addBoard(boardId: string, _name: string) {
    store.set(splitBoards, { type: "insert", value: boardId });
  }

  async setCard(boardId: string, card: CardData) {
    const boardAtom = store
      .get(storageAtom)
      .find((b) => store.get(b).id === boardId);

    if (boardAtom) {
      store.set(boardAtom, (prev) => {
        return {
          ...prev,
          cards: {
            ...prev.cards,
            [card.miroLink!]: card,
          },
        };
      });
    }
  }

  getBoard(boardId: string): BoardInfo | undefined {
    const boardAtom = store
      .get(storageAtom)
      .find((b) => store.get(b).id === boardId);
    if (boardAtom) {
      return store.get(boardAtom);
    }
    return undefined;
  }

  setBoardName(boardId: string, name: string) {
    const boardAtom = store
      .get(storageAtom)
      .find((b) => store.get(b).id === boardId);
    if (boardAtom) {
      store.set(boardAtom, (prev) => ({ ...prev, name }));
    }
  }

  setBoardCards(boardId: string, cards: CardData[]) {
    const boardAtom = store
      .get(storageAtom)
      .find((b) => store.get(b).id === boardId);
    if (boardAtom) {
      store.set(boardAtom, (prev) => {
        return {
          ...prev,
          cards: cards.reduce(
            (acc, c) => {
              acc[c.miroLink!] = c;
              return acc;
            },
            {} as Record<string, CardData>,
          ),
        };
      });
    }
  }

  totalCards() {
    return store
      .get(storageAtom)
      .map((b) => store.get(b))
      .reduce((acc, b) => acc + Object.keys(b.cards).length, 0);
  }

  getCardByLink(link: string): CardData | undefined {
    const boardId = getBoardIdFromMiroLink(link);
    if (!boardId) {
      return undefined;
    }
    const boardAtom = store
      .get(storageAtom)
      .find((b) => store.get(b).id === boardId);
    if (!boardAtom) {
      return undefined;
    }

    return store.get(boardAtom).cards[link];
  }

  deleteCardByLink(link: string) {
    const boardId = getBoardIdFromMiroLink(link);
    if (!boardId) {
      return undefined;
    }
    const boardAtom = store
      .get(storageAtom)
      .find((b) => store.get(b).id === boardId);
    if (!boardAtom) {
      return undefined;
    }

    const board = store.get(boardAtom);
    if (!board) {
      return undefined;
    }
    const cards = { ...board.cards };
    delete cards[link];

    store.set(boardAtom, { ...board, cards });
  }

  set(miroLink: string, card: CardData) {
    const boardId = getBoardIdFromMiroLink(card.miroLink!);
    if (!boardId) {
      return undefined;
    }
    const boardAtom = store
      .get(storageAtom)
      .find((b) => store.get(b).id === boardId);
    if (boardAtom) {
      store.set(boardAtom, (prev) => {
        return {
          ...prev,
          cards: {
            ...prev.cards,
            [miroLink]: card,
          },
        };
      });
    }
  }

  setWorkspaceBoards(boardIds: string[]) {
    store.set(workspaceBoardsAtom, boardIds);
  }
  listWorkspaceBoards() {
    return (
      this.context.workspaceState.get<string[]>(`board-filter`) ??
      this.listBoardIds()
    );
  }

  listBoardIds() {
    return store.get(storageAtom).map((b) => store.get(b).id);
  }
  listAllCards() {
    return store
      .get(storageAtom)
      .flatMap((b) => Object.values(store.get(b).cards));
  }
}

export function getBoardIdFromMiroLink(miroLink: string): string | undefined {
  try {
    const url = new URL(miroLink);
    const match = url.pathname.match(/\/app\/board\/([^/]+)\//);
    if (match) {
      return match[1];
    }
  } catch {
    // Ignore invalid URLs
  }
  return undefined;
}
