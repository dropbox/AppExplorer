import createDebug from "debug";
import { ReactiveController, ReactiveControllerHost } from "lit";
import invariant from "tiny-invariant";
import { ServerStatus } from "../EventTypes";
import { SidebarSocket } from "./socket-context";

const debug = createDebug("app-explorer:socket-subscription-controller");

interface SocketHost extends ReactiveControllerHost {
  _socket: SidebarSocket;
}

export class ServerStatusController implements ReactiveController {
  #host: SocketHost;
  value: ServerStatus | undefined;

  constructor(host: SocketHost) {
    (this.#host = host).addController(this);
  }

  private onValueChange = (newValue: ServerStatus): void => {
    debug("onValueChange", newValue);
    this.value = newValue;
    this.#host.requestUpdate();
  };

  hostConnected(): void {
    invariant(
      this.#host._socket,
      "Socket must be connected before subscribing",
    );
    this.#host._socket.on("serverStatus", this.onValueChange);
  }
  hostDisconnected(): void {
    debug("disconnected");
    this.#host._socket.off("serverStatus", this.onValueChange);
  }
}
