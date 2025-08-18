import { TagColor } from "@mirohq/websdk-types";
import { BoardInfo } from "./card-storage";
import { SymbolPathChangeEvent } from "./document-symbol-tracker";
import {
  AppExplorerTag,
  CardData,
  ServerStatus,
  WorkspaceRegistrationRequest,
  WorkspaceRegistrationResponse,
} from "./EventTypes";
import { PrettyPrint } from "./utils/pretty-print";

// Roles participating in the socket mesh (exported for consumers that need to
// reason about directionality elsewhere).
export type Role = PrettyPrint<keyof SocketEventMap>;

/**
 * MergeUnionOfObjects
 * --------------------
 * Problem:
 *   Given a UNION of object types (e.g. A | B | C) we normally cannot access a property safely
 *   unless it exists on *every* member. Also `keyof (A | B | C)` yields only the keys common
 *   to all members. We want instead a "merged" map with the union of keys and, for each key,
 *   the union of its value types across members.
 *
 * Example:
 *   type U = { a: number; shared: string } | { b: boolean; shared: number };
 *   type M = MergeUnionOfObjects<U>;
 *   // M is: { a: number; b: boolean; shared: string | number }
 *
 * Technique:
 *   We leverage distributive conditional types twice.
 *   1. `[K in U extends unknown ? keyof U : never]` distributes over each member of U to collect
 *      all of its keys; the resulting union of keys becomes the index set for the resulting object.
 *   2. For each candidate key K, we again distribute over U; if the current member contains K we
 *      extract its value type U[K], otherwise `never`. Uniting all those gives us the union of
 *      value types for key K across all members (with `never` disappearing).
 *
 * Notes:
 *   - We use `unknown` instead of `any` to satisfy lint rules while still triggering distribution.
 *   - This helper is intentionally *widening*: overlapping function signatures will become a
 *     union of call signatures (which is often acceptable for events).
 */
type MergeUnionOfObjects<U> = {
  [K in U extends unknown ? keyof U : never]: U extends unknown
    ? K extends keyof U
      ? U[K]
      : never
    : never;
};

/**
 * EventsTo<Map, Target>
 * ---------------------
 * Goal:
 *   From a role→(destination-role→events) adjacency mapping (our `SocketEventMap`), build a merged
 *   object containing *all* event handlers whose destination is `Target` (e.g. "server").
 *
 * Steps:
 *   1. Mapped type iterates each source role `S in keyof Map`.
 *   2. If the source role object contains a property named `Target`, we keep that nested event map;
 *      else we yield `never` (ignored later).
 *   3. Indexing the mapped type with `[keyof Map]` converts the mapped object into a UNION of just
 *      those collected nested event maps (dropping `never`).
 *   4. Pass that union of event maps through `MergeUnionOfObjects` to flatten into a single object
 *      whose keys are the union of all inbound event names and whose values are the union of the
 *      respective handler types.
 *
 * Result:
 *   `EventsTo<SocketEventMap, "server">` ⇒ one object type describing every event that can be
 *   sent TO the server from any other role.
 */
export type EventsTo<Target extends PropertyKey> = MergeUnionOfObjects<
  {
    [S in keyof SocketEventMap]: Target extends keyof SocketEventMap[S]
      ? SocketEventMap[S][Target]
      : never;
  }[keyof SocketEventMap]
>;

export type EventsFrom<Source extends keyof SocketEventMap> =
  MergeUnionOfObjects<SocketEventMap[Source][keyof SocketEventMap[Source]]>;

export type RoutedEvents<
  Source extends keyof SocketEventMap,
  Target extends keyof SocketEventMap,
> = Target extends keyof SocketEventMap[Source]
  ? SocketEventMap[Source][Target]
  : never;

type SocketEventMap = {
  server: {
    sidebar: {
      serverStatus: (status: ServerStatus) => void;
      cardsAroundCursor: (data: CardData[]) => void;
    };
    workspace: {
      connectedBoards: (boards: string[]) => void;
      boardUpdate: (board: BoardInfo | null) => void;
      cardUpdate: (url: string, card: CardData | null) => void;
    };
  };
  miro: {
    workspace: {
      selectedCards: (data: CardData[]) => void;
      navigateTo: (card: CardData) => void;
      card: (data: { url: string; card: CardData | null }) => void;
      log: (args: unknown[]) => void;
    };
  };
  sidebar: {
    server: {
      getInstanceId: (callback: (id: string) => void) => void;
    };
    workspace: {
      navigateTo: (card: CardData) => void;
    };
  };
  workspace: {
    sidebar: {
      symbolsChanged: (symbols: SymbolPathChangeEvent) => void;
    };
    server: {
      workspaceRegistration: (
        request: WorkspaceRegistrationRequest,
        callback: (response: WorkspaceRegistrationResponse) => void,
      ) => void;
    };
    miro: {
      getIdToken: (boardId: string, callback: (id: string) => void) => void;
      setBoardName: (
        boardId: string,
        name: string,
        callback: (success: boolean) => void,
      ) => void;
      getBoardInfo: (
        boardId: string,
        callback: (boardInfo: BoardInfo) => void,
      ) => void;
      tags: (
        boardId: string,
        callback: (tags: AppExplorerTag[]) => void,
      ) => void;
      attachCard: (
        boardId: string,
        data: CardData,
        callback: (success: boolean) => void,
      ) => void;
      tagCards: (
        boardId: string,
        data: {
          miroLink: string[];
          tag:
            | string
            | {
                color: TagColor;
                title: string;
              };
        },
        callback: (success: boolean) => void,
      ) => void;
      selectCard: (
        boardId: string,
        miroLink: string,
        callback: (success: boolean) => void,
      ) => void;
      cardStatus: (
        boardId: string,
        data: {
          miroLink: string;
          status: "connected" | "disconnected";
          codeLink: string | null;
        },
        callback: (success: boolean) => void,
      ) => void;
      cards: (boardId: string, callback: (cards: CardData[]) => void) => void;
      selected: (
        boardId: string,
        callback: (cards: CardData[]) => void,
      ) => void;
      newCards: (
        boardId: string,
        data: CardData[],
        options: { connect?: string[] },
        callback: (success: boolean) => void,
      ) => void;
      hoverCard: (
        boardId: string,
        miroLink: string,
        callback: (success: boolean) => void,
      ) => void;
    };
  };
};
