/* global miro */

import { ContextProvider } from "@lit/context";
import { Task } from "@lit/task";
import "@webcomponents/webcomponentsjs";
import createDebug from "debug";
import { css, html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import { CardData } from "./EventTypes";
import "./lit/app-card";
import { mirotoneStyles, rawMirotoneStyles } from "./lit/mirotone";
import "./lit/onboarding";
import "./lit/server-status";
import { connectSidebarSocket, socketContext } from "./lit/socket-context";
import { extractCardData } from "./miro";

// Mirotone must be loaded on the host page to set all the CSS variables.
document.head.insertAdjacentHTML(
  "beforeend",
  `<style>${rawMirotoneStyles}</style>`,
);

const debug = createDebug("app-explorer:miro:sidebar");

@customElement("app-explorer-sidebar")
export class SidebarElement extends LitElement {
  static styles = [
    mirotoneStyles,
    css`
      .card-list {
        display: flex;
        flex-direction: column;
        gap: var(--space-medium);
        overflow-y: auto;
      }

      .app-card--title {
        overflow: hidden;
      }

      :host {
        display: flex;
        flex-direction: column;
        max-height: 100%;
      }

      .commands {
        padding: 0 var(--space-medium);
      }
    `,
  ];

  private _socketTask = new Task(this, {
    args: () => [],
    task: connectSidebarSocket,
    onComplete: (socket) => {
      this._socketProvider.setValue(socket);
    },
  });

  private _socketProvider = new ContextProvider(this, {
    context: socketContext,
  });

  private _cardsOnBoard = new Task(this, {
    args: () => [],
    task: async (): Promise<null | CardData[]> => {
      if (miro) {
        const allCards = await miro.board.get({ type: "app_card" });
        const getAllCards = async () =>
          (await Promise.all(allCards.map((c) => extractCardData(c)))).filter(
            (c): c is CardData => c !== null,
          );

        return getAllCards();
      }
      return null;
    },
  });

  constructor() {
    super();

    miro?.board.ui.on("items:delete", () => {
      this._cardsOnBoard.run();
    });
    miro?.board.ui.on("items:create", () => {
      this._cardsOnBoard.run();
    });
  }

  render() {
    if (this._cardsOnBoard.value?.length === 0) {
      return html`<app-explorer-onboarding></app-explorer-onboarding>`;
    }

    if (!this._socketProvider.value) {
      return html`<p>Connecting to AppExplorer...</p>`;
    }

    return html`
      <app-explorer-server-status></app-explorer-server-status>
      <hr class="hr" />
      <p class="commands">
        Most functionality is managed in VSCode using the Command Palette.
      </p>

      <div class="card-list">
        ${this._cardsOnBoard.value?.map(
          (card) => html`<app-card .cardData=${card}></app-card>`,
        )}
      </div>
    `;
  }
}
