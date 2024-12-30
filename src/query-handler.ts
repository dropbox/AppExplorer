import * as vscode from "vscode";
import { Queries } from "./EventTypes";

interface BaseEvent {
  requestId: string;
  boardId: string;
}

export interface QueryRequestEvent<Req extends keyof Queries = keyof Queries>
  extends BaseEvent {
  type: "request";
  request: Req;
  data: Parameters<Queries[Req]>;
}

export interface QueryResponseEvent<Req extends keyof Queries = keyof Queries>
  extends BaseEvent {
  type: "response";
  request: Req;
  data: Awaited<ReturnType<Queries[Req]>>;
}

type QueryEvent = QueryRequestEvent | QueryResponseEvent;

export class QueryHandler {
  private eventeEmitter = new vscode.EventEmitter<QueryEvent>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private resolvers: Record<string, (data: any) => void> = {};

  public static defer = Symbol("defer");

  constructor() {
    this.eventeEmitter.event((event) => {
      if (event.type === "response") {
        this.resolvers[event.requestId](event.data);
        delete this.resolvers[event.requestId];
      }
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolve(requestId: string, data: any) {
    const resolve = this.resolvers[requestId];
    delete this.resolvers[requestId];
    resolve(data);
  }

  dispose() {
    this.eventeEmitter.dispose();
  }

  query<Req extends keyof Queries, Res extends ReturnType<Queries[Req]>>(
    boardId: string,
    request: Req,
    ...data: Parameters<Queries[Req]>
  ): Promise<Res> {
    const requestId = Math.random().toString(36);
    return new Promise<Res>((resolve) => {
      this.resolvers[requestId] = resolve;
      this.eventeEmitter.fire({
        type: "request",
        requestId,
        boardId,
        request,
        data,
      });
    });
  }

  listen<Req extends keyof Queries, Res extends ReturnType<Queries[Req]>>(
    handler: (
      event: QueryRequestEvent,
    ) => Promise<Res | typeof QueryHandler.defer>,
  ) {
    return this.eventeEmitter.event(async (event) => {
      if (event.type === "request") {
        const data = await handler(event);
        if (typeof data === "symbol") {
          return;
        }
        this.eventeEmitter.fire({
          ...event,
          type: "response",
          requestId: event.requestId,
          data,
        });
      }
    });
  }

  listenToBoard<
    Req extends keyof Queries,
    Res extends ReturnType<Queries[Req]>,
  >(
    boardId: string,
    handler: (
      event: QueryRequestEvent,
    ) => Promise<Res | typeof QueryHandler.defer>,
  ) {
    return this.listen((event) => {
      if (event.boardId === boardId) {
        return handler(event);
      }
      return Promise.resolve(QueryHandler.defer);
    });
  }
}
