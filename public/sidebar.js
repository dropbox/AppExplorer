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

  results.map((r) => r.card);
  return results.map((r) => r.data);
}

/**
 * @param {Socket} socket
 */
export function attachToSocket(socket) {
  socket.on("activeEditor", (uri) => {
    onActiveEditor(uri);
  });
}
