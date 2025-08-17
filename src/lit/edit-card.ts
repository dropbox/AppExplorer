/* global miro */

import { Task } from "@lit/task";
import "@webcomponents/webcomponentsjs";
import { css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import invariant from "tiny-invariant";
import { CardData } from "../EventTypes";
import { createDebug } from "../utils/create-debug";
import "./app-card";
import { AppElement } from "./app-element";
import "./cards-around-cursor";
import { mirotoneStyles, rawMirotoneStyles } from "./mirotone";
import "./onboarding";
import "./server-status";
import { connectSidebarSocket } from "./socket-context";
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

  private socketTask = new Task(this, {
    args: () => [],
    task: connectSidebarSocket,
  });

  jumpToCode = () => {
    const appCard = this.cardData.value;
    const socket = this.socketTask.value;
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

  render() {
    return this.cardData.render({
      initial: () => html`<p>Loading...</p>`,
      complete: (data) => {
        const cardData = { ...data, ...this.cardEdits };
        return html`
          <form @submit=${this.handleSubmit}>
            <app-card .cardData=${cardData}></app-card>
            <div class="form-group">
              <label for="title">Input label</label>
              <input
                autofocus
                class="input"
                type="text"
                placeholder="Placeholder"
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
