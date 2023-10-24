import { html, render } from "https://unpkg.com/lit-html";
import { appCard } from "./app-card.js";
/* global miro */
/**
 * @typedef {import('@mirohq/websdk-types').Miro} Miro
 * @typedef {import('@mirohq/websdk-types').Card} Card
 * @typedef {import("../src/EventTypes").RequestEvents} RequestEvents
 * @typedef {import('../src/EventTypes').CardGutter} CardGutter
 * @typedef {import('../src/EventTypes').CardData} CardData
 * @typedef {import("socket.io-client").Socket<
 *     import("../src/EventTypes").RequestEvents,
 *     import("../src/EventTypes").ResponseEvents,
 * >} Socket
 */

/**
 * Updates the data of a blank card.
 *
 * @param {Card} card The card to update.
 * @param {Partial<CardData>} data The data to update the card with.
 * @returns {Promise<Card>} The updated card.
 */
async function updateCard(card, data) {
  if (data.title && !card.title) {
    card.title = data.title;
  }
  if (data.codeLink) {
    card.description = data.codeLink;
  }
  /**
   * @type {import('@mirohq/websdk-types').CardField[]}
   */
  const fields = [
    {
      value: data.path,
      tooltip: data.path,
    },
  ];
  if (data.symbol) {
    fields.push({
      value: data.symbol,
      tooltip: `Symbol`,
    });
  }
  card.fields = fields;

  await card.sync();
  await card.setMetadata("app-explorer", data);
  return card;
}

/**
 * @typedef {{
    min: {x: number;y: number;};
    max: {x: number;y: number;};
}} BoundingBox
 */

/**
 * @type {import('../src/EventTypes').Handler<
 *     RequestEvents['activeEditor'],
 *     Promise<Array<CardData>>
 * >}
 */
export async function onActiveEditor(path) {
  const allCards = await miro.board.get({ type: "card" });
  const boardId = await miro.board.getInfo().then((info) => info.id);
  const results = await allCards.reduce(
    /**
     *
     * @param {Promise<Array<{
     *   card: Card,
     *   data: CardData
     * }>>} p
     * @param {Card} card
     * @returns
     */
    async (p, card) => {
      const allCards = await p;
      /**
       * @type {any}
       */
      const metadata = await card.getMetadata();

      /**
       * @type {CardData}
       */
      let data = metadata.data;

      if (!data) {
        const pathField = card.fields?.find(({ value }) =>
          value?.startsWith(path)
        );
        if (pathField && pathField.value) {
          data = await updateOlderCard(pathField.value, card, path, allCards);
        }
      }

      if (data && data.path === path) {
        allCards.push({
          card,
          data: {
            ...data,
            miroLink: `https://miro.com/app/board/${boardId}/?moveToWidget=${card.id}`,
            description: card.description,
          },
        });
      }

      return allCards;
    },
    Promise.resolve([])
  );

  return results.map((r) => r.data);
}

/**
 * @param {string} pathField
 * @param {import("@mirohq/websdk-types").Card} card
 * @param {string} path
 * @param {{ card: any; data: import("../src/EventTypes").CardData; }[]} allCards
 */
async function updateOlderCard(pathField, card, path, allCards) {
  const lines = pathField.split("#")[1];
  const [startLine, endLine] =
    lines?.split("-").map((n) => parseInt(n, 10)) ?? [];

  const symbolPosition = {
    start: {
      line: startLine,
      character: 0,
    },
    end: {
      line: endLine,
      character: Number.MAX_SAFE_INTEGER,
    },
  };
  /**
   * @type {CardData} CardData
   */
  const data = {
    title: card.title,
    path,
    codeLink: card.description,
    symbolPosition: symbolPosition,
    definitionPosition: symbolPosition,
  };

  allCards.push({
    card,
    data,
  });
  await updateCard(card, data);
  return data;
}

/**
 * @param {Socket} socket
 */
export function attachToSocket(socket) {
  /**
   * @type {CardData[]|null} appCards
   */
  let appCards = null;
  function renderUpdate() {
    try {
      render(
        sidebarUI(
          appCards?.filter((c) => c.miroLink).map(appCard) ?? [],
          appCards == null
        ),
        document.getElementById("app")
      );
    } catch (e) {
      console.error(e);
      throw e;
    }
  }
  renderUpdate();

  socket.on("activeEditor", (uri) => {
    onActiveEditor(uri).then((cards) => {
      appCards = cards;
      renderUpdate();
      socket.emit("cardsInEditor", { path: uri, cards });
    });
  });
}

const sidebarUI = (items, loading) => html`
  <div class="grid preview-container">
    ${loading
      ? html`<div class="cs2 ce11">Loading...</div>`
      : html`
          <div class="cs2 ce11">
            <button
              class="btn btn-primary"
              @click=${async () => {
                const allCards = items.map(async (item) =>
                  miro.board.get({ type: "card", id: item.id })
                );
                await miro.board.viewport.zoomTo(
                  ...(await Promise.all(allCards))
                );
              }}
            >
              Zoom to all
            </button>
          </div>
        `}
    ${items.map((i) => html` <div class="cs2 ce11">${i}</div> `)}
  </div>
`;
