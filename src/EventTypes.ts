import { AppCard, TagColor } from "@mirohq/websdk-types";

export type SymbolCardData = {
  boardId: string;
  type: "symbol";
  title: string;
  path: string;
  symbol: string;
  miroLink?: string;
  codeLink: string | null;
  status: AppCard["status"];
};

export type GroupCardData = Pick<
  SymbolCardData,
  "title" | "path" | "status" | "miroLink" | "boardId"
> & {
  type: "group";
};

export type CardData = SymbolCardData | GroupCardData;

export const allColors = [
  "red",
  "magenta",
  "violet",
  "light_green",
  "green",
  "dark_green",
  "cyan",
  "blue",
  "dark_blue",
  "yellow",
  "gray",
  "black",
] as TagColor[];

export type AppExplorerTag = {
  title: string;
  id: string;
  color: TagColor;
};

export type Queries = {
  getIdToken: () => string;
  setBoardName: (name: string) => void;
  getBoardInfo: () => { name: string; boardId: string };
  tags: () => AppExplorerTag[];
  attachCard: (data: CardData) => void;
  tagCards: (data: {
    miroLink: string[];
    tag:
      | string
      | {
          color: TagColor;
          title: string;
        };
  }) => void;
  selectCard: (miroLink: string) => void;
  cardStatus: (data: {
    miroLink: string;
    status: "connected" | "disconnected";
    codeLink: string | null;
  }) => void;
  cards: () => CardData[];
  selected: () => CardData[];
  newCards: (data: CardData[], options?: { connect?: string[] }) => void;
  hoverCard: (miroLink: string) => void;
};

export type RequestEvents = {
  query: <N extends keyof Queries>(data: {
    name: N;
    requestId: string;
    data: Parameters<Queries[N]>;
  }) => void;
};
export type ResponseEvents = {
  cardsInEditor: (data: { path: string; cards: CardData[] }) => void;
  selectedCards: (data: { data: CardData[] }) => void;
  navigateTo: (card: CardData) => void;
  card: (data: { url: string; card: CardData | null }) => void;
  queryResult: <N extends keyof Queries>(data: {
    name: N;
    requestId: string;
    response: ReturnType<Queries[N]>;
  }) => void;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Handler<T extends (...args: any[]) => void, U = void> = (
  ...args: Parameters<T>
) => U;
