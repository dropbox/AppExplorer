import * as vscode from "vscode";

export type CardGutter = { startLine: number; endLine: number };

export type JSPosition = {
  line: number;
  character: number;
};

export type CardData = {
  title: string;
  path: string;
  symbol?: string;
  description?: string;
  miroLink?: string;
  codeLink: string | null;
  symbolPosition: {
    start: JSPosition;
    end: JSPosition;
  };
};

export type RequestEvents = {
  newCard: (data: CardData) => void;
  updateCard: (miroLink: string, data: CardData) => void;
  activeEditor: (uri: string) => void;
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
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Handler<T extends (...args: any[]) => void, U = void> = (
  ...args: Parameters<T>
) => U;
