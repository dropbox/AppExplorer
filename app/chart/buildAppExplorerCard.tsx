import invariant from "tiny-invariant";
import type { AppExplorerConfig } from "~/routes/projects";
import { findSpace } from "./findSpace";
import type { ScanData } from "./index";
import { appExplorerTagId, readProjectId } from "./index";
import { makePermalink } from "./permalinks";
import { theme } from "./theme";

export async function getAppExplorerCard(
  path: string,
  project: AppExplorerConfig
) {
  const tagId = await appExplorerTagId();
  const cards = await miro.board.get({
    type: "card",
  });
  let card = cards.find(
    (card) =>
      card.type === "card" &&
      card.tagIds.includes(tagId) &&
      path === readProjectId(card)
  );
  // This is here to convince TypeScript that cards.find will ONLY find an
  // AppCard
  invariant(card == null || card.type === "card");
  return card;
}

/**
 * Updates or returns the AppData card for this path
 *
 * @AppExplorer
 */
export async function buildAppExplorerCard(
  path: string,
  data: ScanData,
  project: AppExplorerConfig
) {
  const permalink = makePermalink(data.remote, data.hash, path);

  const tagId = await appExplorerTagId();
  const cards = await miro.board.get({
    type: "card",
  });
  let card = cards.find(
    (card) =>
      card.type === "card" &&
      card.tagIds.includes(tagId) &&
      card.title === path &&
      [project.id, null].includes(readProjectId(card))
  );

  if (!card) {
    const { x, y } = await findSpace(
      {
        x: 0,
        y: 0,
        height: 3000,
        width: 3000,
      },
      null,
      "",
      []
    );

    const width = 320;
    card = await miro.board.createCard({
      title: path,
      width,
      rotation: 0.0,
      // status: "connected",
      style: theme.card,
      x,
      y,
    });
  }
  function buildCardContent() {
    let content = "";
    content += `<p><a href="${permalink}">${path}</a></p>`;

    // content += `<p></p>`
    content += `<p><br/><br/>project:${project.id}\n<br/></p>`;
    return content;
  }
  card.description = buildCardContent();

  Object.assign(card.style, theme.card);
  card.tagIds = [tagId];
  // card.fields = [
  //   { value: "path:" + path },
  //   { value: "hash:" + data.hash },
  //   { value: "project:" + project.id },
  //   { value: data.remote },
  // ];
  await card.sync();
  return card;
}
