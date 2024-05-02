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
  await card.setMetadata("codeLink", data.codeLink);
  await card.setMetadata("path", data.path);
  await card.setMetadata("symbol", data.symbol);

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
        console.log("parent", currentItem);
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
  const padding = 50;
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
  socket.on("hoverCard", async (cardUrl) => {
    const url = new URL(cardUrl);
    const id = url.searchParams.get("moveToWidget");

    const card = await miro.board.getById(id);
    await zoomIntoCards([card]);
  });

  socket.on("queryBoard", async () => {
    const cards = await miro.board.get({ type: ["card", "app_card"] });

    const data = await Promise.all(
      cards.map(
        /**
         * @returns {CardData}
         */
        async function makeCardData(card) {
          let path = await card.getMetadata("path");
          let symbol = await card.getMetadata("symbol");
          let codeLink = await card.getMetadata("codeLink");
          if (!path || !symbol) {
            await Promise.all(
              card.fields.map(({ value, tooltip }) => {
                if (!symbol && tooltip === "Symbol") {
                  symbol = value;
                  return card.setMetadata("symbol", symbol);
                } else if (!path && value === tooltip) {
                  path = value;
                  return card.setMetadata("path", path);
                }
              })
            );
          }
          if (!codeLink && card.description) {
            codeLink = card.description;
            await card.setMetadata("codeLink", codeLink);
          }

          const cardData = {
            title: card.title,
            codeLink,
            miroLink: `https://miro.com/app/board/${miro.board.id}/?moveToWidget=${card.id}`,
            path,
            symbol,
          };
          return cardData;
        }
      )
    );
    data.forEach((card) => {
      socket.emit("card", card);
    });
  });

  miro.board.ui.on("selection:update", async (event) => {
    const selectedItems = event.items;
    const cards = selectedItems.filter((item) => item.type === "card");
    const data = await Promise.all(cards.map(extractCardData));
    socket.emit("selectedCards", { data });
  });
}

/**
 *
 * @param {Card} card
 * @returns {CardData}
 */
async function extractCardData(card) {
  const metadata = await card.getMetadata("app-explorer");

  const boardId = await miro.board.getInfo().then((info) => info.id);

  return {
    title: card.title,
    description: card.description,
    miroLink: `https://miro.com/app/board/${boardId}/?moveToWidget=${card.id}&cot=14`,
    path: metadata.path,
    symbol: metadata.symbol,
    codeLink: metadata.codeLink,
    symbolPosition: metadata.symbolPosition,
  };
}

miro.board.ui.on("icon:click", async () => {
  await miro.board.ui.openPanel({ url: "/sidebar.html" });
});
