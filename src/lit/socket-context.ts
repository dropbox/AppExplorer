import { ContextProvider, createContext } from "@lit/context";
import { Task } from "@lit/task";
import "@webcomponents/webcomponentsjs";
import { ReactiveElement } from "lit";
import { Socket, io as socketIO } from "socket.io-client";
import {
  ServerToSidebarOperations,
  SidebarToServerOperations,
  SidebarToWorkspaceOperations,
  WorkspaceToSidebarOperations,
} from "../EventTypes";
import { createDebug } from "../utils/create-debug";
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const debug = createDebug("app-explorer:miro:sidebar");

export type SidebarSocket = Socket<
  ServerToSidebarOperations & WorkspaceToSidebarOperations,
  SidebarToServerOperations & SidebarToWorkspaceOperations
>;

export const socketContext = createContext<SidebarSocket>(
  Symbol("socketContext"),
);

let instanceId: string | null = null;
export async function connectSidebarSocket() {
  debug("connectSidebarSocket");
  await new Promise((resolve) => setTimeout(resolve, 100));

  const connectionTimeout = 10000; // 10 second connection timeout
  const socket: SidebarSocket = socketIO("/sidebar", {
    transports: ["websocket"],
    timeout: connectionTimeout,
    reconnection: true,
    forceNew: false, // Force new connection on each attempt
  });

  let connected = false;
  const onConnect = async () => {
    debug("onConnect");
    try {
      const id = await socket.emitWithAck("getInstanceId").catch((error) => {
        debug("Error getting instance ID:", error);
        return null;
      });

      debug("onConnect", { id, instanceId });
      if (instanceId === null) {
        instanceId = id;
      } else if (instanceId === id) {
        debug("socket reconnected");
      } else {
        debug("New socket instance, refreshing...");
        window.location.reload();
        return;
      }

      connected = true;
    } catch (e) {
      debug("error", String(e));
    }
  };
  socket.on("connect", onConnect);
  socket.on("disconnect", (reason) => {
    debug("disconnected", reason);
    if (reason === "transport close") {
      debug("retry");
      const i = setInterval(() => {
        debug(
          "Reconnecting socket...",
          socket.connected,
          socket.disconnected,
          socket.recovered,
        );
        if (socket.connected) {
          clearInterval(i);
          onConnect();
          return;
        }
        socket.connect();
      }, 1000);
    } else {
      debug("Socket disconnected");
    }
  });

  while (!connected) {
    await delay(100);
  }

  return socket;
}

export class SocketProvider extends ContextProvider<
  { __context__: SidebarSocket },
  ReactiveElement
> {
  constructor(host: ReactiveElement) {
    super(host, {
      context: socketContext,
    });
  }
  _socketTask = new Task(this.host, {
    args: () => [],
    task: connectSidebarSocket,
    onComplete: (socket) => {
      this.setValue(socket);
    },
  });
}
