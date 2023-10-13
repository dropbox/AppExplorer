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
 *
 * @param {Card[]} items
 * @returns {BoundingBox}
 */
function boundingBox(items) {
  return items.reduce(
    (box, item) => {
      const x = item.x;
      const y = item.y;
      const halfWidth = item.width / 2;
      const halfHeight = item.height / 2;
      box.min.x = Math.min(box.min.x, x - halfWidth);
      box.min.y = Math.min(box.min.y, y - halfHeight);
      box.max.x = Math.max(box.max.x, x + halfWidth);
      box.max.y = Math.max(box.max.y, y + halfHeight);
      return box;
    },
    {
      min: { x: Number.MAX_SAFE_INTEGER, y: Number.MAX_SAFE_INTEGER },
      max: { x: Number.MIN_SAFE_INTEGER, y: Number.MIN_SAFE_INTEGER },
    }
  );
}

/**
 *
 * @param {Card[]} cards
 * @returns {import('@mirohq/websdk-types').Rect}
 */
function makeRect(cards) {
  const box = boundingBox(cards);
  return {
    x: box.min.x,
    y: box.min.y,
    width: box.max.x - box.min.x,
    height: box.max.y - box.min.y,
  };
}

async function nextCardLocation() {
  const selection = (await miro.board.getSelection()).filter(
    /**
     * @returns {item is Card}
     */
    (item) => item.type === "card"
  );
  const width = 300;
  const height = 200;

  if (selection.length === 0) {
    const viewport = await miro.board.viewport.get();

    const x = viewport.x + viewport.width / 2;
    const y = viewport.y + viewport.height / 2;
    const box = { x, y, width, height };
    return box;
  }

  const box = makeRect(selection);

  const gap = 200;

  return {
    x: box.x + box.width / 2,
    y: box.y + box.height + gap,
    width,
    height,
  };
}

/**
 * @type {import('../src/EventTypes').Handler<RequestEvents['newCard'], Promise<Card>>}
 */
const newCard = async (data) => {
  const selection = (await miro.board.getSelection()).filter(
    (item) => item.type === "card"
  );

  const card = await miro.board.createCard(await nextCardLocation());
  zoomIntoCards([selection, card].flat());
  await updateCard(card, data);

  if (selection.length > 0) {
    await selection.reduce(async (promise, item) => {
      await promise;
      return miro.board.createConnector({
        start: { item: item.id },
        end: { item: card.id },
        shape: "curved",
        style: {
          startStrokeCap: "none",
          endStrokeCap: "arrow",
        },
      });
    }, Promise.resolve(null));
  }

  return card;
};

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

  const cards = results.map((r) => r.card);
  if (cards.length > 0) {
    const selection = await miro.board.getSelection();
    await zoomIntoCards([selection, ...cards].flat());
  }

  return results.map((r) => r.data);
}

async function zoomIntoCards(cards) {
  const viewport = makeRect(cards);
  const padding = 50;
  await miro.board.viewport.set({
    viewport: viewport,
    padding: { top: padding, right: padding, bottom: padding, left: padding },
  });
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
  socket.on("newCard", (event) => {
    newCard(event).then(async (card) => {
      const uri = event.path;

      await miro.board.deselect();
      await miro.board.select({ id: card.id });
      await onActiveEditor(uri).then((cards) => {
        socket.emit("cardsInEditor", { path: uri, cards });
      });
    });
  });
  //   socket.on("updateCard", (cardUrl, data) => {
  //     newCard(data).then(() => {
  //       activeEditor(data.path);
  //     });
  //   });

  socket.on("activeEditor", (uri) => {
    onActiveEditor(uri).then((cards) => {
      socket.emit("cardsInEditor", { path: uri, cards });
    });
  });
}
