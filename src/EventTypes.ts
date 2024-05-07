import { AppCard, TagColor } from "@mirohq/websdk-types";
import * as vscode from "vscode";

export type CardGutter = { startLine: number; endLine: number };

export type JSPosition = {
  line: number;
  character: number;
};

export type SymbolCardData = {
  type: 'symbol'
  title: string;
  path: string;
  symbol: string;
  miroLink?: string;
  codeLink: string | null;
  status: AppCard['status'];
};

export type GroupCardData = Pick<SymbolCardData, 'title'|'path'|'status'|'miroLink'> & {
  type: 'group',
}

export type CardData = SymbolCardData | GroupCardData

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


export type Tag = {
  title: string;
  id: string;
  color: TagColor;
};

export type Queries = {
  tags: () => Tag[];
  cards: () => CardData[]
  selected: () => CardData[];
};

export type RequestEvents = {
  newCards: (data: CardData[]) => void;
  attachCard: (data: CardData) => void;
  hoverCard: (miroLink: string) => void;
  selectCard: (miroLink: string) => void;
  cardStatus: (data: {
    miroLink: string;
    status: "connected" | "disconnected";
  }) => void;
  tagCards: (data: {
    miroLink: string[];
    tag: string | {
      color: TagColor;
      title: string;
    }
  }) => void;
  query: <N extends keyof Queries>(data: {
    name: N;
    requestId: string;
    data: Parameters<Queries[N]>;
  }) => void;
  jump: (data: {
    lastUri: string;
    lastPosition: vscode.Position;
    uri: string;
    position: vscode.Position;
  }) => void;
};
export type ResponseEvents = {
  cardsInEditor: (data: { path: string; cards: CardData[] }) => void;
  selectedCards: (data: { data: CardData[] }) => void;
  navigateTo: (card: CardData) => void;
  card: (data: { url: string, card: CardData }) => void;
  queryResult: <N extends keyof Queries>(data: {
    requestId: string,
    response: Queries[N],
  }) => void;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Handler<T extends (...args: any[]) => void, U = void> = (
  ...args: Parameters<T>
) => U;
