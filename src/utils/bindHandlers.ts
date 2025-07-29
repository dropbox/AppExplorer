import { Socket } from "socket.io-client";
import { EventMapType } from "../EventTypes";

export function bindHandlers<T extends EventMapType>(
  socket: Socket<T, any>,
  handlers: T,
) {
  Object.keys(handlers).forEach((k) => {
    const event = k as keyof typeof handlers;
    const handler = handlers[event];
    if (typeof event === "string") {
      socket.on(event, handler);
    }
  });
}
