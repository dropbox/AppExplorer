/* global miro */

import type {
  AppCard,
  BoardNode,
  CardField,
  Item,
  Rect,
  Tag,
} from "@mirohq/websdk-types";
import createDebug from "debug";
import { type Socket, io as socketIO } from "socket.io-client";
import invariant from "tiny-invariant";
import {
  type AppExplorerTag,
  type CardData,
  type MiroToWorkspaceOperations,
  type WorkspaceToMiroOperations,
} from "./EventTypes";
import { bindHandlers } from "./utils/bindHandlers";
import { notEmpty } from "./utils/notEmpty";

let debug = createDebug("app-explorer:miro");

function decode(str: string) {
  return str.replaceAll(/&#([0-9A-F]{2});/g, (_, charCode) =>
    String.fromCharCode(parseInt(charCode)),
  );
}

type MetaData = {
  path: string;
  symbol: string | null;
  codeLink: string | null;
};

async function updateCard(
  card: AppCard,
  data: Partial<CardData>,
): Promise<AppCard> {
  let metaData: MetaData;
  invariant(data.path, "missing data.path in updateCard");
  if (data.type === "symbol") {
    metaData = {
      path: data.path,
      symbol: data.symbol ?? null,
      codeLink: data.codeLink ?? null,
    };
  } else {
    throw new Error(`Invalid card type: ${data.type}`);
  }

  await card.setMetadata("app-explorer", metaData);
  if (metaData.codeLink) {
    card.linkedTo = metaData.codeLink ?? "";
  }

  card.title = data.title ?? "";
  const fields: CardField[] = [
    {
      value: data.path,
      tooltip: data.path,
    },
  ];
  if (metaData.symbol) {
    fields.push({
      value: metaData.symbol,
      tooltip: `Symbol ${metaData.symbol}`,
    });
  }
  card.fields = fields;
  await card.sync();

  return card;
}

type BoundingBox = {
  min: { x: number; y: number };
  max: { x: number; y: number };
};

async function boundingBox(items: AppCard[]): Promise<BoundingBox> {
  return items.reduce(
    async (p: Promise<BoundingBox>, item): Promise<BoundingBox> => {
      const box: BoundingBox = await p;
      const x = item.x;
      const y = item.y;
      const halfWidth = item.width / 2;
      const halfHeight = item.height / 2;
      box.min.x = Math.min(box.min.x, x - halfWidth);
      box.min.y = Math.min(box.min.y, y - halfHeight);
      box.max.x = Math.max(box.max.x, x + halfWidth);
      box.max.y = Math.max(box.max.y, y + halfHeight);

      let currentItem: BoardNode = item;
      if (currentItem && currentItem.parentId) {
        currentItem = await miro.board.getById(currentItem.parentId);
        if (currentItem && "x" in currentItem) {
          box.min.x += currentItem.x;
          box.min.y += currentItem.y;
          box.max.x += currentItem.x;
          box.max.y += currentItem.y;
          if (
            currentItem.origin === "center" &&
            "width" in currentItem &&
            currentItem.width &&
            currentItem.height
          ) {
            box.min.x -= currentItem.width / 2;
            box.min.y -= currentItem.height / 2;
            box.max.x -= currentItem.width / 2;
            box.max.y -= currentItem.height / 2;
          }
        }
      }
      return box;
    },
    Promise.resolve({
      min: { x: Number.MAX_SAFE_INTEGER, y: Number.MAX_SAFE_INTEGER },
      max: { x: Number.MIN_SAFE_INTEGER, y: Number.MIN_SAFE_INTEGER },
    } as BoundingBox),
  );
}

async function makeRect(cards: AppCard[]): Promise<Rect> {
  const box = await boundingBox(cards);
  return {
    x: box.min.x,
    y: box.min.y,
    width: box.max.x - box.min.x,
    height: box.max.y - box.min.y,
  };
}

const isTag = (item: Item): item is Tag => item.type === "tag";
const isAppCard = (item: Item): item is AppCard => item.type === "app_card";
async function nextCardLocation() {
  const selection = (await miro.board.getSelection()).filter(isAppCard);
  const width = 300;
  const height = 200;
  const gap = 200;

  let centerX: number;
  let centerY: number;
  let radiusX: number;
  let radiusY: number;
  if (selection.length === 0) {
    const viewport = await miro.board.viewport.get();
    centerX = viewport.x + viewport.width / 2;
    centerY = viewport.y + viewport.height / 2;
    radiusX = 0;
    radiusY = 0;
  } else {
    const box = await makeRect(selection);
    centerX = box.x + box.width / 2;
    centerY = box.y + box.height / 2;
    // use separate radii to account for rectangular dimensions and keep
    // the gap between card edges roughly constant
    radiusX = box.width / 2 + width / 2 + gap;
    radiusY = box.height / 2 + height / 2 + gap;
  }

  const startAngle = Math.PI / 2; // straight down
  const angleStep = Math.PI / 4; // 45° increments
  let angle = startAngle;
  let x = centerX + radiusX * Math.cos(angle);
  let y = centerY + radiusY * Math.sin(angle);

  const selectionIds = new Set(selection.map((c) => c.id));
  const cards = (
    await miro.board.get({
      type: ["app_card"],
    })
  )
    .filter(isAppCard)
    .filter((c) => !selectionIds.has(c.id));

  const overlaps = (cx: number, cy: number) =>
    cards.some(
      (card) =>
        Math.abs(cx - card.x) < (width + card.width) / 2 &&
        Math.abs(cy - card.y) < (height + card.height) / 2,
    );

  let attempts = 0;
  const fullCircle = Math.round((2 * Math.PI) / angleStep);
  while (overlaps(x, y)) {
    angle += angleStep;
    attempts++;
    if (attempts >= fullCircle) {
      attempts = 0;
      radiusX += width + gap;
      radiusY += height + gap;
      angle = startAngle;
    }
    x = centerX + radiusX * Math.cos(angle);
    y = centerY + radiusY * Math.sin(angle);
  }

  return { x, y, width, height };
}

const newCard = async (cards: CardData[], options: { connect?: string[] }) => {
  if (cards.length > 1) {
    await miro.board.deselect({
      id: (await miro.board.getSelection()).map((c) => c.id),
    });
  }

  let selection = (await miro.board.getSelection()).filter(isAppCard);
  if (options.connect) {
    const ids = options.connect
      .map((url) => new URL(url).searchParams.get("moveToWidget"))
      .filter(notEmpty);
    selection = (
      await Promise.all(ids.map((id) => miro.board.getById(id)))
    ).filter(isAppCard);
  }

  const newCardLocation = await nextCardLocation();
  return cards.reduce(
    async (p, cardData, index) => {
      const accumulatedCards = await p;

      const card = await miro.board.createAppCard({
        ...newCardLocation,
        y: newCardLocation.y + index * 200,
        status: "connected",
      });
      zoomIntoCards([...selection, ...accumulatedCards, card].flat());
      await updateCard(card, cardData);

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
      if (index === 0 && cards.length > 1) {
        selection = [card];

        await miro.board.deselect({
          id: (await miro.board.getSelection()).map((c) => c.id),
        });
        await miro.board.select({ id: card.id });
      }
      return [...accumulatedCards, card];
    },
    Promise.resolve([] as AppCard[]),
  );
};
async function zoomIntoCards(cards: AppCard[]) {
  await miro.board.viewport.zoomTo(
    await Promise.all(
      cards.map(async (card) => {
        if (card.parentId) {
          const frame = await miro.board.getById(card.parentId);
          if (frame?.type === "frame") {
            return frame;
          }
        }
        return card;
      }),
    ),
  );
}

export async function attachToSocket() {
  const socket = socketIO() as Socket<
    WorkspaceToMiroOperations,
    MiroToWorkspaceOperations
  >;
  debug = debug.extend(
    socket.id || Math.random().toString(36).substring(2, 15),
  );
  const originalLog = debug.log;
  debug.log = (...args) => {
    originalLog(...args);
    socket.emit("log", args);
  };

  miro.board.ui.on("icon:click", async () => {
    await miro.board.ui.openPanel({ url: "/sidebar.html" });
  });

  const boardId = await miro.board.getInfo().then((info) => info.id);
  const queryImplementations: WorkspaceToMiroOperations = {
    setBoardName: async (routedBoardId, name, done) => {
      invariant(routedBoardId === boardId, "Board ID mismatch");
      await miro.board.setAppData("name", name);
      done(true);
    },
    getBoardInfo: async (routedBoardId, done) => {
      // The boardID might not be known by the client yet, so an empty string is passed as a placeholder.
      invariant(
        routedBoardId === "" || boardId === routedBoardId,
        "Board ID mismatch",
      );
      const name = (await miro.board.getAppData("name")) as string;
      queryImplementations.cards(boardId, (cardArray) => {
        done({
          boardId,
          name,
          cards: cardArray.reduce(
            (acc: Record<string, CardData>, c: CardData) => {
              acc[c.miroLink!] = c;
              return acc;
            },
            {} as Record<string, CardData>,
          ),
        });
      });
    },
    newCards: async (routedBoardId, cards, options, done) => {
      try {
        invariant(routedBoardId === boardId, "Board ID mismatch");
        await newCard(cards, options).then(async (cards) => {
          const selection = await miro.board.getSelection();
          await miro.board.deselect({
            id: selection.map((c) => c.id),
          });
          if (cards.length > 0) {
            await miro.board.select({ id: cards.map((c) => c.id) });
          }
        });
        done(true);
      } catch (error) {
        debug("AppExplorer: Error creating new cards", error);
        done(false);
      }
    },
    getIdToken: (routedBoardId, done) => {
      invariant(routedBoardId === boardId, "Board ID mismatch");
      return miro.board.getIdToken().then((id) => done(id));
    },
    attachCard: async (routedBoardId, cardData, done) => {
      try {
        invariant(routedBoardId === boardId, "Board ID mismatch");
        const selection = await miro.board.getSelection();
        const card = selection[0];
        if (selection.length === 1 && isAppCard(card)) {
          const updatedCard = await updateCard(card, cardData);
          updatedCard.status = "connected";
          await updatedCard.sync();
          await miro.board.deselect({
            id: selection.map((c) => c.id),
          });
          await miro.board.select({ id: card.id });
          const data = await extractCardData(updatedCard);
          if (data && data.miroLink) {
            socket.emit("card", { url: data.miroLink, card: data });
            miro.board.notifications.showInfo(`Updated card: ${data.title}`);
          }
        }
        done(true);
      } catch (error) {
        debug("AppExplorer: Error attaching card", error);
        done(false);
      }
    },
    hoverCard: async (routedBoardId, cardUrl, done) => {
      try {
        invariant(routedBoardId === boardId, "Board ID mismatch");
        const url = new URL(cardUrl);
        const id = url.searchParams.get("moveToWidget")!;

        const card = await miro.board.getById(id);
        invariant(isAppCard(card), "card must be an app_card");
        await zoomIntoCards([card]);
        done(true);
      } catch (error) {
        debug("AppExplorer: Error hovering card", error);
        done(false);
      }
    },
    cards: async (routedBoardId, done) => {
      invariant(routedBoardId === boardId, "Board ID mismatch");
      const cards = (
        await miro.board.get({
          type: ["app_card"],
        })
      ).filter((c) => c.type === "app_card");
      done((await Promise.all(cards.map(extractCardData))).filter(notEmpty));
    },
    selectCard: async (routedBoardId, cardUrl, done) => {
      try {
        invariant(routedBoardId === boardId, "Board ID mismatch");
        const url = new URL(cardUrl);
        const id = url.searchParams.get("moveToWidget")!;
        const card = await miro.board.getById(id);
        if (card && isAppCard(card)) {
          const selection = await miro.board.getSelection();
          await miro.board.deselect({
            id: selection.map((c) => c.id),
          });
          await miro.board.select({ id: card.id });
          await zoomIntoCards([card]);
          miro.board.notifications.showInfo(`Selected card: ${card.title}`);
        } else {
          socket.emit("card", { url: cardUrl, card: null });
          miro.board.notifications.showError(`Card not found ${cardUrl}`);
        }
        done(true);
      } catch (error) {
        debug("AppExplorer: Error selecting card", error);
        miro.board.notifications.showError(
          `AppExplorer: Error selecting card ${error}`,
        );
        done(false);
      }
    },
    cardStatus: async (routedBoardId, { miroLink, status, codeLink }, done) => {
      try {
        invariant(routedBoardId === boardId, "Board ID mismatch");
        const url = new URL(miroLink);
        const id = url.searchParams.get("moveToWidget")!;
        const card = await miro.board.getById(id);

        if (isAppCard(card)) {
          card.status = status;
          if (codeLink) {
            card.linkedTo = codeLink;
          }
          await card.sync();
        }
      } catch (error) {
        debug("AppExplorer: Error updating card status", error);
      }
      done(true);
    },
    tags: async (routedBoardId, done) => {
      invariant(routedBoardId === boardId, "Board ID mismatch");
      const selection = await miro.board.get({ type: "tag" });
      done(
        await Promise.all(
          selection.map(
            (tag): AppExplorerTag => ({
              id: tag.id,
              title: tag.title,
              color: tag.color as AppExplorerTag["color"],
            }),
          ),
        ),
      );
    },
    tagCards: async (routedBoardId, { miroLink: links, tag }, done) => {
      try {
        invariant(routedBoardId === boardId, "Board ID mismatch");
        let tagObject: Tag;
        if (typeof tag === "string") {
          const tmp = await miro.board.getById(tag);
          if (tmp && isTag(tmp)) {
            tagObject = tmp;
          }
        } else {
          tagObject = await miro.board.createTag({
            color: tag.color,
            title: tag.title,
          });
        }

        await links.reduce(async (p, miroLink) => {
          await p;
          const url = new URL(miroLink);
          const id = url.searchParams.get("moveToWidget")!;
          const card = await miro.board.getById(id);
          invariant(isAppCard(card), "card must be an app_card");

          if (card.tagIds.includes(tagObject.id)) {
            card.tagIds = card.tagIds.filter((id) => id !== tagObject.id);
          } else {
            card.tagIds.push(tagObject.id);
          }
          await card.sync();
        }, Promise.resolve());

        done(true);
      } catch (error) {
        debug("AppExplorer: Error tagging cards", error);
        done(false);
      }
    },
    selected: async (routedBoardId, done) => {
      invariant(routedBoardId === boardId, "Board ID mismatch");
      const selection = await miro.board.getSelection();
      done(
        (await Promise.all(selection.map(extractCardData))).filter(notEmpty),
      );
    },
  };
  bindHandlers(socket, queryImplementations);

  miro.board.ui.on("app_card:open", async (event) => {
    try {
      const { appCard } = event;
      const data = await extractCardData(appCard);
      if (data) {
        await miro.board.select({ id: appCard.id });
        socket.emit("navigateTo", data);
        miro.board.notifications.showInfo("Opening card in VSCode");
      }
    } catch (error) {
      debug("AppExplorer: Error opening app card", error);
    }
  });
  miro.board.ui.on("app_card:connect", async (event) => {
    try {
      const { appCard } = event;
      const data = await extractCardData(appCard);
      if (data) {
        await miro.board.select({ id: appCard.id });
        socket.emit("navigateTo", data);
        miro.board.notifications.showInfo("Opening card in VSCode");
      }
    } catch (error) {
      debug("AppExplorer: Error connecting app card", error);
    }
  });

  miro.board.ui.on("items:delete", async function (event) {
    try {
      await event.items.reduce(
        async (promise: Promise<null>, item: AppCard) => {
          await promise;
          const data = await extractCardData(item);
          if (data?.miroLink) {
            socket.emit("card", { url: data.miroLink, card: data });
            miro.board.notifications.showInfo("Deleting card in VSCode");
          }
          return null;
        },
        Promise.resolve(null),
      );
    } catch (error) {
      debug("AppExplorer: Error deleting items", error);
    }
  });

  miro.board.ui.on("selection:update", async function selectionUpdate(event) {
    try {
      const selectedItems = event.items;
      const data = (
        await Promise.all(selectedItems.map(extractCardData))
      ).filter(notEmpty);

      if (data.length > 0) {
        data.forEach((card) => {
          socket.emit("card", {
            url: card.miroLink!,
            card,
          });
        });
      }
      socket.emit("selectedCards", data);
    } catch (error) {
      debug("AppExplorer: Notifying VSCode of updated selection", error);
    }
  });
}

export async function extractCardData(card: Item): Promise<CardData | null> {
  if (!isAppCard(card)) {
    return null;
  }
  const metadata: MetaData = await card.getMetadata("app-explorer");
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const { codeLink, path, symbol } = metadata as Record<string, string>;

    const boardId = await miro.board.getInfo().then((info) => info.id);
    if (card.linkedTo !== codeLink && codeLink) {
      card.linkedTo = codeLink as string;
      await card.sync();
    }

    return {
      type: "symbol",
      boardId,
      title: decode(card.title),
      // description: decode(card.description),
      miroLink: `https://miro.com/app/board/${boardId}/?moveToWidget=${card.id}`,
      path: path,
      symbol: symbol,
      codeLink: codeLink,
      status: isAppCard(card) ? card.status : "disconnected",
    };
  }
  return null;
}
