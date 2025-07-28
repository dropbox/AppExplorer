/* global miro */

import type {
  AppCard,
  BoardNode,
  CardField,
  Item,
  Rect,
  Tag,
} from "@mirohq/websdk-types";
import { type Socket } from "socket.io-client";
import invariant from "tiny-invariant";
import {
  type AppExplorerTag,
  type CardData,
  type Handler,
  type MiroToWorkspaceEvents,
  type WorkspaceToMiroOperations,
} from "./EventTypes";

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
  if (data.type === "group") {
    metaData = {
      path: data.path,
      symbol: null,
      codeLink: null,
    };
  } else if (data.type === "symbol") {
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

const newCard: Handler<
  WorkspaceToMiroOperations["newCards"],
  Promise<AppCard[]>
> = async (cards, options = {}) => {
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
  const { io } = await import(
    // @ts-ignore I need to use a dynamic import to avoid importing from
    // index-{hash}.js
    "https://cdn.socket.io/4.3.2/socket.io.esm.min.js"
  );

  const socket = io() as Socket<
    WorkspaceToMiroOperations,
    MiroToWorkspaceEvents
  >;

  const queryImplementations: WorkspaceToMiroOperations = {
    setBoardName: async (name: string) => {
      await miro.board.setAppData("name", name);
    },
    getBoardInfo: async (done) => {
      const boardId = await miro.board.getInfo().then((info) => info.id);
      const name = (await miro.board.getAppData("name")) as string;
      done({ boardId, name });
    },
    newCards: async (cards, options, done) => {
      try {
        await newCard(cards, options).then(async (cards) => {
          const selection = await miro.board.getSelection();
          await miro.board.deselect({
            id: selection.map((c) => c.id),
          });
          if (cards.length > 0) {
            await miro.board.select({ id: cards.map((c) => c.id) });
          }
        });
      } catch (error) {
        console.error("AppExplorer: Error creating new cards", error);
      } finally {
        done?.();
      }
    },
    getIdToken: (done) => miro.board.getIdToken().then(done),
    attachCard: async (cardData, done) => {
      try {
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
      } catch (error) {
        console.error("AppExplorer: Error attaching card", error);
      }
      done?.();
    },
    hoverCard: async (cardUrl, done) => {
      try {
        const url = new URL(cardUrl);
        const id = url.searchParams.get("moveToWidget")!;

        const card = await miro.board.getById(id);
        invariant(isAppCard(card), "card must be an app_card");
        await zoomIntoCards([card]);
      } catch (error) {
        console.error("AppExplorer: Error hovering card", error);
      }
      done?.();
    },
    cards: async (done) => {
      const cards = (
        await miro.board.get({
          type: ["app_card"],
        })
      ).filter((c) => c.type === "app_card");
      done((await Promise.all(cards.map(extractCardData))).filter(notEmpty));
    },
    selectCard: async (cardUrl, done) => {
      try {
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
          done(true);
        } else {
          socket.emit("card", { url: cardUrl, card: null });
          miro.board.notifications.showError(`Card not found ${cardUrl}`);
        }
      } catch (error) {
        console.error("AppExplorer: Error selecting card", error);
        miro.board.notifications.showError(
          `AppExplorer: Error selecting card ${error}`,
        );
      }
      done(false);
      return false;
    },
    cardStatus: async ({ miroLink, status, codeLink }, done) => {
      try {
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
        console.error("AppExplorer: Error updating card status", error);
      }
      done?.();
    },
    tags: async (done) => {
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
    tagCards: async ({ miroLink: links, tag }, done) => {
      try {
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
      } catch (error) {
        console.error("AppExplorer: Error tagging cards", error);
      }
      done?.();
    },
    selected: async (done) => {
      const selection = await miro.board.getSelection();
      done(
        (await Promise.all(selection.map(extractCardData))).filter(notEmpty),
      );
    },
  };

  Object.keys(queryImplementations).forEach((key) => {
    const query = key as keyof typeof queryImplementations;
    socket.on(query, queryImplementations[query]);
  });

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
      console.error("AppExplorer: Error opening app card", error);
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
      console.error("AppExplorer: Error connecting app card", error);
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
      console.error("AppExplorer: Error deleting items", error);
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
      socket.emit("selectedCards", { data });
    } catch (error) {
      console.error(
        "AppExplorer: Notifying VSCode of updated selection",
        error,
      );
    }
  });
}

function notEmpty<T>(t: T | null): t is T {
  return t != null;
}

async function extractCardData(card: Item): Promise<CardData | null> {
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
      type: symbol ? "symbol" : "group",
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
