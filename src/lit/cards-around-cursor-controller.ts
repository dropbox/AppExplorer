import { ContextConsumer } from "@lit/context";
import { LitElement, ReactiveController, ReactiveControllerHost } from "lit";
import { CardData } from "../EventTypes";
import { createDebug } from "../utils/create-debug";
import { SidebarSocket, socketContext } from "./socket-context";
const debug = createDebug("app-explorer:cards-around-cursor:controller");

export class CardsAroundCursorController implements ReactiveController {
  #host: ReactiveControllerHost;
  value: CardData[] | undefined;
  private _socketContext: ContextConsumer<
    {
      __context__: SidebarSocket;
    },
    LitElement
  >;
  listening: boolean = false;

  constructor(host: LitElement) {
    (this.#host = host).addController(this);
    this._socketContext = new ContextConsumer(host, {
      context: socketContext,
    });
  }

  private onValueChange = (newValue: CardData[]): void => {
    debug("symbolsChanged event", newValue.length);
    this.value = newValue;
    this.#host.requestUpdate();
  };

  hostUpdated() {
    if (!this.listening) {
      this.subscribe();
    }
  }

  hostConnected(): void {
    const socket = this._socketContext.value;
    if (socket) {
      this.subscribe();
    }
  }

  private subscribe(): void {
    this.listening = true;
    const socket = this._socketContext.value!;
    socket.on("cardsAroundCursor", this.onValueChange);
  }
  hostDisconnected(): void {
    const socket = this._socketContext.value!;
    socket.off("cardsAroundCursor", this.onValueChange);
  }
}
