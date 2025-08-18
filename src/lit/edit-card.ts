/* global miro */

import { Task } from "@lit/task";
import "@webcomponents/webcomponentsjs";
import classNames from "classnames";
import { css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import invariant from "tiny-invariant";
import { CardData } from "../EventTypes";
import { createDebug } from "../utils/create-debug";
import "./app-card";
import { AppElement } from "./app-element";
import "./cards-around-cursor";
import { CardsAroundCursorController } from "./cards-around-cursor-controller";
import { mirotoneStyles, rawMirotoneStyles } from "./mirotone";
import "./onboarding";
import "./server-status";
import { SocketProvider } from "./socket-context";
// Mirotone must be loaded on the host page to set all the CSS variables.
document.head.insertAdjacentHTML(
  "beforeend",
  `<style>${rawMirotoneStyles}</style>`,
);

const debug = createDebug("app-explorer:miro:edit-card");

@customElement("app-explorer-edit-card")
export class EditCardElement extends AppElement {
  static styles = [
    mirotoneStyles,
    css`
      app-explorer-edit-card {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        justify-content: start;
        width: 30rem;
        height: 100%;
        padding: 0 1rem;
      }

      app-explorer-edit-card .form-group {
        margin: 1rem 0;
      }

      .form-group.expand {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        z-index: 10;
        background-color: white;
        padding: 1rem;
        border: 1px solid black;
        margin: 0;

        & > label + * {
          flex-grow: 1;
        }
      }

      .form-group > label {
        display: flex;
        flex-direction: row;
        justify-content: space-between;
      }

      .flex-row {
        display: flex;
        flex-direction: row;
      }

      .space-between {
        justify-content: space-between;
      }
    `,
  ];
  private cardData = new Task(this, {
    args: () => [],
    task: async () => {
      const data = await miro.board.ui.getModalData<CardData>();
      invariant(data, "Missing panel data");
      return data;
    },
  });

  @state()
  private cardEdits: Partial<CardData> = {};

  private cardsAroundCursor: CardsAroundCursorController | undefined;
  private _socketProvider = new SocketProvider(this, (socket) => {
    this.cardsAroundCursor = new CardsAroundCursorController(this, socket);
  });

  private _miroTags = new Task(this, {
    args: () => [],
    task: async () => miro.board.get({ type: "tag" }),
  });

  jumpToCode = () => {
    const appCard = this.cardData.value;
    const socket = this._socketProvider.value;
    try {
      if (appCard && socket) {
        socket.emit("navigateTo", appCard);
        miro.board.notifications.showInfo("Opening card in VSCode");
        miro.board.ui.closeModal();
      }
    } catch (error) {
      debug.error("AppExplorer: Error opening app card", error);
    }
  };

  handleSubmit = (e: SubmitEvent) => {
    const data = this.cardData.value;
    e.preventDefault();
    miro.board.ui.closeModal({ ...data, ...this.cardEdits });
  };

  @state()
  private _expandDescription = false;

  render() {
    const symbolsAroundCursor = this.cardsAroundCursor?.value ?? [];

    return this.cardData.render({
      initial: () => html`<p>Loading...</p>`,
      complete: (data) => {
        const cardData = { ...data, ...this.cardEdits };
        return html`
          <form @submit=${this.handleSubmit}>
            <app-card .cardData=${cardData}></app-card>
            <div class="form-group">
              <label for="title">Title</label>
              <input
                autofocus
                class="input"
                type="text"
                value=${cardData.title}
                @input=${(e: InputEvent) => {
                  this.cardEdits = {
                    ...this.cardEdits,
                    title: (e.target as HTMLInputElement).value,
                  };
                }}
                id="title"
              />
            </div>
            <div
              class=${classNames("form-group", {
                expand: this._expandDescription,
              })}
            >
              <label for="description"
                >description

                <button
                  @click=${() =>
                    (this._expandDescription = !this._expandDescription)}
                  class="button button-primary button-small expand-button"
                  type="button"
                  aria-label="label"
                >
                  <span class="icon-expand"></span>
                </button>
              </label>
              <textarea
                class=${classNames("textarea")}
                type="text"
                @input=${(e: InputEvent) => {
                  this.cardEdits = {
                    ...this.cardEdits,
                    description: (e.target as HTMLInputElement).value,
                  };
                }}
                .value=${cardData.description ?? ""}
                id="description"
                rows="3"
              ></textarea>
            </div>
            <div class="form-group">
              <label for="symbol">Symbol Path</label>
              <select
                id="symbol"
                class="select"
                @change=${(e: InputEvent) => {
                  const [path, symbol] = (
                    e.target as HTMLSelectElement
                  ).value.split("\n");

                  this.cardEdits = {
                    ...this.cardEdits,
                    path,
                    symbol,
                  };
                }}
              >
                <option
                  value=${data.path + "\n" + data.symbol}
                  ?selected=${data.symbol === cardData.symbol}
                >
                  ${data.symbol}
                </option>
                ${symbolsAroundCursor.map(
                  (card) => html`
                    <option
                      value=${card.path + "\n" + card.symbol}
                      ?selected=${card.symbol === cardData.symbol}
                    >
                      ${card.symbol}
                    </option>
                  `,
                )}
              </select>
            </div>

            <div class="flex-row space-between">
              <button
                class="button button-secondary"
                type="button"
                @click=${this.jumpToCode}
              >
                Jump to Code
              </button>
              <button class="button button-primary" type="submit">Save</button>
            </div>
          </form>
        `;
      },

      error: (_error) => html`<p>Error loading card data ${String(_error)}</p>`,
    });
  }
}
