import type { AppCard, Item, Shape } from "@mirohq/websdk-types";
import type { ScanData } from "./index";
import { todoTagId } from "./index";
import { GITHUB_ORIGIN } from "./index";
import { findSpace } from "./findSpace";
import { theme } from "./theme";
import type { JSDocEntry } from "~/scanner/jsdoc-scanner";

/**
 *
 * @TODO Get a regex to match everywhere DBX hosts source code and match up
 * permalinks here
 */
function makePermalink(remote: string, hash: string, location: string) {
  const github = remote.match(GITHUB_ORIGIN);
  if (github) {
    const [, org, repo] = github;
    return `https://github.com/${org}/${repo}/blob/${hash}/${location}`;
  }

  return null;
}

const JSDOC_SHAPE = "round_rectangle";

/**
 * This builds any JSDoc nodes, doing its best to connect to its proper parent.
 * If the JSDoc was attached to something that wasn't picked up in a scanner, it
 * will attach to the AppCard for its module
 *
 * @AppExplorer
 */
export async function buildJSDoc(
  jsDoc: JSDocEntry,
  data: ScanData,
  parentNode: Shape | AppCard,
  frameChildren: Array<Item>
) {
  console.group("buildJSDoc " + jsDoc.location);
  if (jsDoc.comment.match(/^@TODO/)) {
    return buildTODO(jsDoc, data, parentNode, frameChildren);
  }

  const parentTag = `<p>parent: ${jsDoc.parentNodeId}${jsDoc.key}</p>`;

  /**
   *
   * @param s
   * @returns
   */
  const isSameNode = (s: Shape) => {
    if (s.shape === JSDOC_SHAPE) {
      return s.content.includes(parentTag);
    }
    return false;
  };

  let content = ``;
  let permalink: string | null = null;
  if (data.remote && data.hash) {
    if ("location" in jsDoc) {
      permalink = makePermalink(data.remote, data.hash, jsDoc.location);
    }
  }
  if (permalink != null) {
    content = `<p><a href="${permalink}" target="_blank">source</a></p>`;
  }

  content += jsDoc.comment
    .split("\n")
    .map((c) => `<p>${c}</p>`)
    .join("");
  content += `<p>parent: ${jsDoc.parentNodeId}</p>`;

  let shape: Shape | undefined;

  // Lookup the shape from its permalink
  if (jsDoc.boardLink?.comment) {
    let url;
    try {
      // This might fail to parse
      url = new URL(jsDoc.boardLink?.comment);
      const id = url?.searchParams.get("moveToWidget");

      // the item might not exist anymore
      const widget = id ? await miro.board.getById(id) : null;
      if (widget && widget.type === "shape") {
        shape = widget;
      }
    } catch (e) {
      // Ignore any errors finding the existing card by its link.
    }
  }

  // Scan through shapes and try to find a match
  if (!shape) {
    const shapes = await miro.board.get({
      type: "shape",
    });
    shape = shapes.find(isSameNode);
  }

  // Create a shape if none was found
  if (!shape) {
    const width = 500;
    const estimatedNumberOfLines = content.split("<p>").length;
    const height = 20 + 20 * estimatedNumberOfLines;

    const defaultLocation = await findSpace(
      {
        x: parentNode?.x ?? 0,
        y: parentNode?.y ?? 0,
        width,
        height,
      },
      null,
      "",
      frameChildren
    );

    const newShape = await miro.board.createShape({
      content,
      shape: JSDOC_SHAPE,
      // x: 0,
      // y: 0,
      width,
      height,
      x: defaultLocation.x,
      y: defaultLocation.y,
      style: {
        ...theme.jsDoc,
      },
    });
    shape = newShape;
  }
  shape.content = content;
  await shape.sync();

  if (jsDoc.boardLink) {
    const boardInfo = await miro.board.getInfo();
    jsDoc.boardLink.permalink = `https://miro.com/app/board/${boardInfo.id}/?moveToWidget=${shape.id}&cot=14`;
  }

  console.groupEnd();
  return shape;
}

export async function buildTODO(
  jsDoc: JSDocEntry,
  data: ScanData,
  parentNode: Shape | AppCard,
  frameChildren: Array<Item>
) {
  const tagId = await todoTagId();
  let cards = await miro.board.get({
    type: "card",
    tags: tagId,
  });

  const lines = jsDoc.comment.split("\n");
  const title = lines[0];

  let card = cards.find((c) => {
    return c.title === title;
  });
  const cardData = {
    title,
    tagIds: [tagId],
    description: jsDoc.comment,
  };
  if (!card) {
    const defaultLocation = await findSpace(
      {
        x: parentNode?.x ?? 0,
        y: parentNode?.y ?? 0,
        width: 320,
        height: 50,
      },
      null,
      "",
      frameChildren
    );
    card = await miro.board.createCard({
      ...cardData,
      ...defaultLocation,
      height: undefined,
      style: theme.todo,
    });
  } else {
    Object.assign(card, cardData);
    Object.assign(card.style, theme.todo);
    await card.sync();
  }

  return card;
}
