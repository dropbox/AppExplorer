import { AppCard, TagColor } from "@mirohq/websdk-types";
import { z } from "zod";

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

const zSymbolCardData: z.ZodType<SymbolCardData> = z.object({
  boardId: z.string(),
  type: z.literal("symbol"),
  title: z.string(),
  path: z.string(),
  symbol: z.string(),
  miroLink: z.string().optional(),
  codeLink: z.string().nullable(),
  status: z.enum(["disabled", "disconnected", "connected"]),
});

export type GroupCardData = Pick<
  SymbolCardData,
  "title" | "path" | "status" | "miroLink" | "boardId"
> & {
  type: "group";
};
export const zGroupCardData: z.ZodType<GroupCardData> = z.object({
  boardId: z.string(),
  type: z.literal("group"),
  title: z.string(),
  path: z.string(),
  status: z.enum(["disabled", "disconnected", "connected"]),
  miroLink: z.string().optional(),
});

export type CardData = SymbolCardData | GroupCardData;

export const zCardData = z.union([zSymbolCardData, zGroupCardData]);

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

export type QueryKeys = keyof Queries;
export type Queries = {
  echo: (str: string) => Promise<string>;
  getIdToken: () => Promise<string>;
  setBoardName: (name: string) => Promise<void>;
  getBoardInfo: () => Promise<{ name: string; boardId: string }>;
  tags: () => Promise<AppExplorerTag[]>;
  attachCard: (data: CardData) => Promise<void>;
  tagCards: (data: {
    miroLink: string[];
    tag:
      | string
      | {
          color: TagColor;
          title: string;
        };
  }) => Promise<void>;
  selectCard: (miroLink: string) => Promise<boolean>;
  cardStatus: (data: {
    miroLink: string;
    status: "connected" | "disconnected";
    codeLink: string | null;
  }) => Promise<void>;
  cards: () => Promise<CardData[]>;
  selected: () => Promise<CardData[]>;
  newCards: (
    data: CardData[],
    options?: { connect?: string[] },
  ) => Promise<void>;
  hoverCard: (miroLink: string) => Promise<void>;
};

export type RequestEvents = {
  query: <N extends QueryKeys>(data: {
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
  queryResult: <N extends QueryKeys>(data: {
    name: N;
    requestId: string;
    response: Awaited<ReturnType<Queries[N]>>;
  }) => void;
};

export type Handler<T extends (...args: any[]) => void, U = void> = (
  ...args: Parameters<T>
) => U;
