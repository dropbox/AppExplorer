/* global miro */
/**
 * @typedef {import('@mirohq/websdk-types').Miro} Miro
 * @typedef {import('@mirohq/websdk-types').Card} Card
 * @typedef {import("../EventTypes").RequestEvents} RequestEvents
 * @typedef {import('../EventTypes').CardGutter} CardGutter
 * @typedef {import('../EventTypes').CardData} CardData
 * @typedef {import("socket.io-client").Socket<
 *     import("../EventTypes").RequestEvents,
 *     import("../EventTypes").ResponseEvents,
 * >} Socket
 */

/**
 * @type {RequestEvents['newCard']}
 */
const newCard = async (data) => {
  const { title, path, symbolPosition } = data;
  const zoom = await miro.board.viewport.getZoom();
  const viewport = await miro.board.viewport.get();

  const x = viewport.x + viewport.width / 2;
  const y = viewport.y + viewport.height / 2;
  const width = 300;
  const height = 200;
  const projectTag = null;
  const style = {};
  /**
   * @type {import('@mirohq/websdk-types').CardField[]}
   */
  const fields = [
    {
      value: path,
    },
    {
      value: `position:${symbolPosition.start.line},${symbolPosition.start.character}-${symbolPosition.end.line},${symbolPosition.end.character}}`,
    },
  ];

  const card = await miro.board.createCard({
    x,
    y,
    width: width / zoom,
    height: height / zoom,
    title,
    style,
    tagIds: projectTag ? [projectTag] : [],
    fields,
  });

  await card.setMetadata("data", data);
};

/**
 * @type {import('../EventTypes').Handler<
 *     RequestEvents['activeEditor'],
 *     Promise<Array<CardData>>
 * >}
 */
export async function activeEditor(path) {
  const allCards = await miro.board.get({ type: "card" });
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
      const data = metadata.data;

      if (data && data.path === path) {
        allCards.push({
          card,
          data,
        });
      }

      return allCards;
    },
    Promise.resolve([])
  );

  const cards = results.map((r) => r.card);
  console.log("cards", cards);
  if (cards.length > 0) {
    await miro.board.viewport.zoomTo(cards);
  }

  return results.map((r) => r.data);
}

/**
 * @param {Socket} socket
 */
export function attachToSocket(socket) {
  socket.on("newCard", (event) => {
    newCard(event);
  });

  socket.on("activeEditor", (uri) => {
    activeEditor(uri).then((cards) => {
      socket.emit("cardsInEditor", { path: uri, cards });
    });
  });
}
