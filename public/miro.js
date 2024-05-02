/* global miro */

function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
/**
 * @typedef {Object} MetaData
 * @property {string} path
 * @property {string} symbol
 * @property {string} codeLink
 */

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
  /** @type {MetaData} */
  const metaData = {
    path: data.path,
    symbol: data.symbol,
    codeLink: data.codeLink,
  };
  await card.setMetadata("app-explorer", metaData);
  card.linkedTo = data.codeLink;

  card.title = data.title;
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

  const data2 = await extractCardData(card);
  invariant(data2.title === data.title, "title mismatch");
  invariant(data2.path === data.path, "path mismatch");
  invariant(data2.symbol === data.symbol, "symbol mismatch");
  invariant(data2.codeLink === data.codeLink, "codeLink mismatch");
  invariant(data2.description === data.description, "description mismatch");
  invariant(data2.miroLink === data.miroLink, "miroLink mismatch");

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
async function boundingBox(items) {
  return items.reduce(
    async (p, item) => {
      const box = await p;
      const x = item.x;
      const y = item.y;
      const halfWidth = item.width / 2;
      const halfHeight = item.height / 2;
      box.min.x = Math.min(box.min.x, x - halfWidth);
      box.min.y = Math.min(box.min.y, y - halfHeight);
      box.max.x = Math.max(box.max.x, x + halfWidth);
      box.max.y = Math.max(box.max.y, y + halfHeight);

      let currentItem = item;
      while (currentItem && currentItem.parentId) {
        currentItem = await miro.board.getById(currentItem.parentId);
        if (currentItem) {
          box.min.x += currentItem.x;
          box.min.y += currentItem.y;
          box.max.x += currentItem.x;
          box.max.y += currentItem.y;
          if (currentItem.origin === "center") {
            box.min.x -= currentItem.width / 2;
            box.min.y -= currentItem.height / 2;
            box.max.x -= currentItem.width / 2;
            box.max.y -= currentItem.height / 2;
          }
        }
      }
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
async function makeRect(cards) {
  const box = await boundingBox(cards);
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

  const box = await makeRect(selection);

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
async function zoomIntoCards(cards) {
  const viewport = await makeRect(cards);
  let padding = Math.max(viewport.width, viewport.height) * 1.3;
  padding = Math.min(
    // 400 seems like the largest reasonable padding based on some expermenting.
    400,
    padding
  );
  await miro.board.viewport.set({
    viewport: viewport,
    padding: { top: padding, right: padding, bottom: padding, left: padding },
  });
}

/**
 * @param {Socket} socket
 */
export function attachToSocket(socket) {
  socket.on("newCard", (event) => {
    newCard(event).then(async (card) => {
      await miro.board.deselect();
      await miro.board.select({ id: card.id });
    });
  });
  socket.on("attachCard", async (cardData) => {
    const selection = await miro.board.getSelection();
    const card = selection[0];
    if (selection.length === 1 && card.type === "card") {
      await updateCard(card, cardData);
      await miro.board.deselect();
      await miro.board.select({ id: card.id });
      socket.emit("card", extractCardData(card));
    }
  });
  socket.on("selectCard", async (cardUrl) => {
    const url = new URL(cardUrl);
    const id = url.searchParams.get("moveToWidget");
    const card = await miro.board.getById(id);
    await miro.board.deselect();
    await miro.board.select({ id });
    await zoomIntoCards([card]);
  });
  socket.on("hoverCard", async (cardUrl) => {
    const url = new URL(cardUrl);
    const id = url.searchParams.get("moveToWidget");

    const card = await miro.board.getById(id);
    await zoomIntoCards([card]);
  });

  socket.on("queryBoard", async () => {
    const cards = await miro.board.get({ type: ["card", "app_card"] });

    await cards.reduce(async (promise, card) => {
      await promise;
      const data = await extractCardData(card);
      if (data) {
        socket.emit("card", data);
      }
    }, Promise.resolve(null));
  });

  miro.board.ui.on("selection:update", async function selectionUpdate(event) {
    const selectedItems = event.items;
    const cards = selectedItems.filter((item) => item.type === "card");
    let data = await Promise.all(cards.map(extractCardData));
    data = data.filter((d) => d != null);

    if (data.length > 0) {
      socket.emit("selectedCards", { data });
    }
  });
}

/**
 *
 * @param {Card} card
 * @returns {Promise<CardData>}
 */
async function extractCardData(card) {
  /** @type {MetaData} */
  const metadata = await card.getMetadata("app-explorer");
  if (metadata) {
    const boardId = await miro.board.getInfo().then((info) => info.id);
    if (card.linkedTo !== metadata.codeLink) {
      card.linkedTo = metadata.codeLink;
      await card.sync();
    }

    return {
      title: card.title,
      description: card.description,
      miroLink: `https://miro.com/app/board/${boardId}/?moveToWidget=${card.id}`,
      path: metadata.path,
      symbol: metadata.symbol,
      codeLink: metadata.codeLink,
    };
  }
  return null;
}

miro.board.ui.on("icon:click", async function openSidebar() {
  await miro.board.ui.openPanel({ url: "/sidebar.html" });
});
