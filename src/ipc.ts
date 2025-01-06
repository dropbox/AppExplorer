/* eslint-disable @typescript-eslint/no-explicit-any */
import * as vscode from "vscode";
import { Socket } from "net";
import i from "node-ipc";
import { logger } from "./ChannelLogger";
import { MiroServer, type MiroEvents } from "./server";
import { Queries } from "./EventTypes";

const ipc =
  /**
   * I'm not sure why the runtime of VSCode appears to import node-ipc
   * differently from the way it's typed. This function is also compatible with
   * importing this module to test things with node.
   */
  (function hackIpcModule(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    m: any,
  ): typeof i {
    if (m.default) {
      return hackIpcModule(m.default);
    }
    if (m.config) {
      return m;
    }
    throw new Error("Could not find node-ipc module");
  })(i);

ipc.config.unlink = true;
ipc.config.id = "AppExplorer";
ipc.config.logInColor = false;
ipc.config.logger = (msg) => logger.log(msg);
ipc.config.logger = () => {};

type Query<
  T extends keyof Queries = keyof Queries,
  Args = Parameters<Queries[T]>,
> = {
  type: "query";
  requestId: string;
  boardId: string;
  name: T;
  args: Args;
};
type QueryResult<
  T extends keyof Queries = keyof Queries,
  R = Awaited<ReturnType<Queries[T]>>,
> = {
  type: "queryResult";
  requestId: string;
  boardId: string;
  name: T;
  response: R;
};

type IPCEvent =
  | Query
  | QueryResult
  | { type: "miro"; event: MiroEvents }
  | { type: "registerClient"; clientId: string }
  | { type: "clientIds"; data: string[] };

export class IPCClient extends MiroServer {
  clientId = Math.random().toString(36).substring(2);
  queries: Record<string, (data: any) => void> = {};
  subscriptions: vscode.Disposable[] = [];

  async query<Req extends keyof Queries, Res extends ReturnType<Queries[Req]>>(
    boardId: string,
    name: Req,
    ...args: Parameters<Queries[Req]>
  ): Promise<Res> {
    return new Promise<Res>((resolve) => {
      const requestId = Math.random().toString(36);
      this.queries[requestId] = resolve;
      ipc.server.broadcast(
        "data",
        identity<IPCEvent>({
          type: "query",
          requestId,
          boardId,
          name,
          args,
        }),
      );
    });
  }

  public async init() {
    const clientIds = new Set<string>([this.clientId]);
    ipc.config.maxRetries = 4;
    ipc.config.retry = 1500;

    logger.log("AppExplorer: ipcClient", this.clientId);
    ipc.connectTo(ipc.config.id, () => {
      const s = ipc.of[ipc.config.id];
      s.on("connect", () => {
        s.emit(
          "data",
          identity<IPCEvent>({
            type: "registerClient",
            clientId: this.clientId,
          }),
        );
      });

      s.on("data", (d) => {
        try {
          const event = JSON.parse(String(d)) as IPCEvent;
          switch (event.type) {
            case "miro": {
              this.fire(event.event);
              break;
            }
            case "clientIds": {
              clientIds.clear();
              event.data.forEach((id: string) => clientIds.add(id));
              break;
            }
            case "query": {
              // The client sends queries to the server to be relayed out to
              // Miro boards.
              break;
            }
            case "queryResult": {
              const resolve = this.queries[event.requestId];
              if (resolve) {
                resolve(event.response);
                delete this.queries[event.requestId];
              }
              break;
            }
          }
        } catch (e) {
          logger.log("Error", e, d);
        }
      });
      s.on("error", (e) => {
        console.warn("AppExplorer Client error", e);
      });
      s.on("destroy", () => {
        logger.log("destroy");
      });
      s.on("socket.disconnected", () => {
        logger.log("socket.disconnected");
      });
      s.on("disconnect", () => {
        logger.log("disconnect");
        // const sortedIds = Array.from(clientIds).sort();
        // const isLowestId= sortedIds.indexOf(this.clientId) === 0
      });
    });
  }
  dispose() {
    ipc.server.stop();
    this.subscriptions.forEach((s) => s.dispose());
  }
}

export class IPCServer extends vscode.EventEmitter<IPCEvent> {
  serverId = Math.random().toString(36).substring(2);
  clientIds = new Set<string>();
  readyPromise: Promise<boolean>;
  constructor(private miroServer: MiroServer) {
    super();
    this.readyPromise = this.init();
  }

  public broadcast(event: MiroEvents) {
    ipc.server.broadcast("data", identity<IPCEvent>({ type: "miro", event }));
  }
  private async init() {
    return new Promise<boolean>((resolve, reject) => {
      ipc.serve(
        `${ipc.config.socketRoot}${ipc.config.appspace}${ipc.config.id}`,
        () => {
          const server = ipc.server;

          server.on("connect", (socket: Socket) => {
            const socketId: string | null = null;
            socket.on("data", async (d) => {
              try {
                const event = JSON.parse(d.toString()) as IPCEvent;
                logger.log("socket data", typeof event, event);
                switch (event.type) {
                  case "clientIds": {
                    // server broadcasts IDs to the clients
                    // so this is handled on the client side
                    break;
                  }
                  case "query": {
                    const response = await this.miroServer.query(
                      event.boardId,
                      event.name,
                      ...event.args,
                    );
                    socket.emit(
                      "data",
                      identity<IPCEvent>({
                        type: "queryResult",
                        requestId: event.requestId,
                        boardId: event.boardId,
                        name: event.name,
                        response,
                      }),
                    );
                    break;
                  }
                  case "registerClient": {
                    this.clientIds.add(event.clientId);
                    server.broadcast(
                      "data",
                      identity<IPCEvent>({
                        type: "clientIds",
                        data: Array.from(this.clientIds),
                      }),
                    );
                    break;
                  }
                  case "miro":
                  case "queryResult":
                  default:
                }
              } catch (e) {
                console.error("AppExplorer Error parsing data", e);
              }
            });
            socket.on("end", () => {
              if (socketId) {
                this.clientIds.delete(socketId);
                ipc.log("allClients", Array.from(this.clientIds));
                server.broadcast(
                  "data",
                  identity<IPCEvent>({
                    type: "clientIds",
                    data: Array.from(this.clientIds),
                  }),
                );
              }
            });
          });
          resolve(true);
        },
      );
      try {
        ipc.server.on("error", (e) => {
          if (e.code === "EADDRINUSE") {
            ipc.server.stop();
            reject(e);
            return;
          }
          reject(e);
          console.warn("AppExplorer server error", e);
        });
        ipc.server.start();
      } catch (e) {
        ipc.server.stop();
        reject(e);
      }
      ipc.log("appExplorer started");
    });
  }

  dispose() {
    super.dispose();
    ipc.server.stop();
  }
}

function identity<T>(x: T): T {
  return x;
}

throw new Error("Not Ready Yet");
