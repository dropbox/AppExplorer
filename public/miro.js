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
 * @type {import('../src/EventTypes').Handler<RequestEvents['newCard'], Promise<void>>}
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
 * @type {import('../src/EventTypes').Handler<
 *     RequestEvents['activeEditor'],
 *     Promise<Array<CardData>>
 * >}
 */
export async function activeEditor(path) {
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
          data = await upgradeCard(pathField.value, card, path, allCards);
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

  const cards = results.map((r) => r.card);
  console.log("cards", cards);
  if (cards.length > 0) {
    await miro.board.viewport.zoomTo(cards);
  }

  return results.map((r) => r.data);
}

/**
 * @param {string} pathField
 * @param {import("@mirohq/websdk-types").Card} card
 * @param {string} path
 * @param {{ card: any; data: import("../src/EventTypes").CardData; }[]} allCards
 */
async function upgradeCard(pathField, card, path, allCards) {
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
    symbolPosition: symbolPosition,
    definitionPosition: symbolPosition,
  };

  await card.setMetadata("data", data);

  allCards.push({
    card,
    data,
  });
  return data;
}

/**
 * @param {Socket} socket
 */
export function attachToSocket(socket) {
  socket.on("newCard", (event) => {
    newCard(event).then(() => {
      activeEditor(event.path);
    });
  });

  socket.on("activeEditor", (uri) => {
    activeEditor(uri).then((cards) => {
      socket.emit("cardsInEditor", { path: uri, cards });
    });
  });
}
