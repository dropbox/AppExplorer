import { css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { CardData } from "../EventTypes";
import { isAppCard } from "../miro/isAppCard";
import { updateCard } from "../miro/updateCard";
import { createDebug } from "../utils/create-debug";
import { AppElement } from "./app-element";
import { CardsAroundCursorController } from "./cards-around-cursor-controller";
import { mirotoneStyles } from "./mirotone";
const debug = createDebug("app-explorer:cards-around-cursor");

@customElement("app-explorer-cards-around-cursor")
export class CardsAroundCursorElement extends AppElement {
  static styles = [
    mirotoneStyles,
    css`
      app-explorer-cards-around-cursor {
        display: flex;
        flex-direction: column;
        gap: var(--space-xsmall);
      }
      app-explorer-cards-around-cursor app-card {
        background: blue;
      }

      .gap-small {
        gap: var(--space-xsmall);
      }

      .flex-row {
        display: flex;
        flex-direction: row;
      }
    `,
  ];

  controller: CardsAroundCursorController = new CardsAroundCursorController(
    this,
  );

  connectedCallback(): void {
    super.connectedCallback();
    miro?.board.ui.on("drop", this.onDrop);
    miro?.board.ui.on("selection:update", this.selectionUpdate);
    this.selectionUpdate();
  }

  @state()
  private numSelectedItems = 0;
  selectionUpdate = async () => {
    this.numSelectedItems = (await miro.board.getSelection()).filter(
      isAppCard,
    ).length;
    debug(`Number of selected items: ${this.numSelectedItems}`);
  };

  onDrop = async ({
    x,
    y,
    target,
  }: {
    x: number;
    y: number;
    target: HTMLElement;
  }) => {
    const cardData = JSON.parse(target.dataset.card!) as CardData;
    cardData.boardId = (await miro?.board.getInfo()).id;

    const card = await updateCard(
      await miro.board.createAppCard({
        x,
        y,
        title: cardData.title,
        status: "connected",
      }),
      cardData,
    );

    if (target.dataset.attachSelected === "true") {
      let selection = (await miro.board.getSelection()).filter(isAppCard);

      if (selection.length > 0) {
        await selection.reduce(async (promise, item) => {
          await miro.board.createConnector({
            start: { item: item.id },
            end: { item: card.id },
            shape: "curved",
            style: {
              startStrokeCap: "none",
              endStrokeCap: "arrow",
            },
          });
          return promise;
        }, Promise.resolve(null));
      }
    }
  };

  disconnectedCallback(): void {
    miro?.board.ui.off("drop", this.onDrop);
    miro?.board.ui.off("selection:update", this.selectionUpdate);
  }

  @state()
  attachSelected = true;

  render() {
    const symbolCards = this.controller.value ?? [];

    if (symbolCards.length === 0) {
      return html`<div class="no-symbols">No symbols around cursor</div>`;
    }

    const cards = html`
      ${symbolCards.map(
        (s) => html`
          <app-card
            ?hideTags=${true}
            ?attachSelected=${this.attachSelected}
            .cardData=${s}
          ></app-card>
        `,
      )}
    `;

    return html`
      <div class="flex-row gap-small">
        <input
          type="checkbox"
          id="attach"
          ?checked=${this.attachSelected}
          @change=${(ev: Event) => {
            this.attachSelected = (ev.target as HTMLInputElement).checked;
          }}
        />
        <label for="attach"
          >Add connecting lines from selected cards to new cards
          <span>(${this.numSelectedItems} cards)</span>
        </label>
      </div>
      ${cards}
    `;
  }
}
