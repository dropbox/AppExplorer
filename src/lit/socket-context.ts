import { createContext } from "@lit/context";
import "@webcomponents/webcomponentsjs";
import createDebug from "debug";
import { Socket, io as socketIO } from "socket.io-client";
import {
  ServerToSidebarOperations,
  SidebarToServerOperations,
} from "../EventTypes";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let debug = createDebug("app-explorer:miro:sidebar");

export type SidebarSocket = Socket<
  ServerToSidebarOperations,
  SidebarToServerOperations
>;

export const socketContext = createContext<SidebarSocket>(
  Symbol("socketContext"),
);

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

  debug = debug.extend(
    socket.id || Math.random().toString(36).substring(2, 15),
  );

  let connected = false;
  const onConnect = async () => {
    // debug("socket connected");
    // try {
    //   const serverStatus = await socket.emitWithAck("getServerStatus");
    //   debug("getServerStatus response", { serverStatus });
    // } catch (e) {
    //   debug("getServerStatus error", e);
    // }
    connected = true;
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
