import { ContextConsumer } from "@lit/context";
import { LitElement, ReactiveController, ReactiveControllerHost } from "lit";
import { CardData } from "../EventTypes";
import { createDebug } from "../utils/create-debug";
import { SidebarSocket, socketContext } from "./socket-context";
const debug = createDebug("app-explorer:cards-around-cursor:controller");

export class CardsAroundCursorController implements ReactiveController {
  #host: ReactiveControllerHost;
  value: CardData[] | undefined;
  #socket: SidebarSocket | undefined;
  private _socketContext?: ContextConsumer<
    {
      __context__: SidebarSocket;
    },
    LitElement
  >;
  listening: boolean = false;
  retry: NodeJS.Timeout | undefined;

  constructor(host: LitElement, socket?: SidebarSocket) {
    (this.#host = host).addController(this);
    this.#socket = socket;

    if (!socket) {
      this._socketContext = new ContextConsumer(host, {
        context: socketContext,
      });
    }
  }

  get socket() {
    return this.#socket || this._socketContext?.value;
  }

  private onValueChange = (newValue: CardData[]): void => {
    debug("symbolsChanged event", newValue.length);
    this.value = newValue;
    this.#host.requestUpdate();
  };

  hostUpdated() {
    this.subscribe();
  }

  hostConnected(): void {
    this.subscribe();
  }

  private subscribe(): void {
    if (this.socket) {
      this.socket.on("cardsAroundCursor", this.onValueChange);
      this.listening = true;
      this.retry = undefined;
      debug("listening for cardsAroundCursor");
    } else {
      debug("not connected, retrying...");
      this.retry = setTimeout(() => this.subscribe(), 500);
    }
  }
  hostDisconnected(): void {
    if (this.socket) {
      this.socket.off("cardsAroundCursor", this.onValueChange);
    }
    if (this.retry) {
      clearTimeout(this.retry);
    }
  }
}
