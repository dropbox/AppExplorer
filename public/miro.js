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
  if (data.title) {
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
  card.fields = fields;

  await card.sync();
  await card.setMetadata("app-explorer", data);
  return card;
}

/**
 * @type {import('../src/EventTypes').Handler<RequestEvents['newCard'], Promise<Card>>}
 */
const newCard = async (data) => {
  await miro.board.viewport.setZoom(1);
  const zoom = await miro.board.viewport.getZoom();
  const viewport = await miro.board.viewport.get();

  const x = viewport.x + viewport.width / 2;
  const y = viewport.y + viewport.height / 2;
  const width = 300;
  const height = 200;

  const card = await miro.board.createCard({
    x,
    y,
    width: width / zoom,
    height: height / zoom,
  });

  const lastCard = pinnedCards[pinnedCards.length - 1];
  if (lastCard) {
    await miro.board.createConnector({
      start: { item: lastCard.id },
      end: { item: card.id },
    });
  }

  return updateCard(card, data);
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

  const cards = results.map((r) => r.card);
  console.log("cards", cards);
  if (cards.length > 0) {
    await miro.board.viewport.zoomTo([pinnedCards, ...cards].flat());
    const zoom = await miro.board.viewport.getZoom();
    if (zoom > 1) {
      await miro.board.viewport.setZoom(1);
    }
  }

  return results.map((r) => r.data);
}
/**
 * @type {Card[]}
 */
let pinnedCards = [];

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
    title: card.title.split(" ")[0],
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
  socket.on("newCard", (event) => {
    newCard(event).then((card) => {
      pinnedCards.push(card);
      activeEditor(event.path);
    });
  });
  //   socket.on("updateCard", (cardUrl, data) => {
  //     newCard(data).then(() => {
  //       activeEditor(data.path);
  //     });
  //   });

  socket.on("activeEditor", (uri) => {
    activeEditor(uri).then((cards) => {
      socket.emit("cardsInEditor", { path: uri, cards });
    });
  });
}
