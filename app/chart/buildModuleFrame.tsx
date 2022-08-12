import type { AppCard, Item, Shape } from "@mirohq/websdk-types";
import invariant from "tiny-invariant";
import type { AppExplorerConfig } from "~/routes/projects";
import { buildAppExplorerCard } from "./buildAppExplorerCard";
import { buildComponent, findComponentShape } from "./buildComponent";
import { buildJSDoc } from "./buildJSDoc";
import { connectItems } from "./connectItems";
import { cleanupMoveMarker } from "./findSpace";
import type { ScanData } from "./index";
import { theme } from "./theme";

/**
 * Originally I had planned on having a frame around each module. I ran into
 * some problems, including a bug in Miro.  I need the card to anchor the module
 * and re-open the UI, but the frame isn't strictly necessary.
 *
 * Eash step is supposed to add/update, but will not move existing elements.
 * 1. buildAppExplorerCard - This is the root of the module
 * 2. Queue all exported modules, they get connected to the AppCard
 * 3. Process modules
 *    * Each component holds a list of what else it refers to. These get queued
 *      after the module is created.
 * 4. Process any jsDoc that was collected through @AppExplorer tags
 *
 * @AppExplorer
 */
export async function buildModuleFrame(
  data: ScanData,
  path: string,
  project: AppExplorerConfig
) {
  console.clear();
  console.warn("Cleared console for debugging");
  console.group("buildModuleFrame " + path);

  const frameChildren: Array<Item> = [];

  console.group("buildAppExplorerCard");
  const appCard = await buildAppExplorerCard(path, data, project);
  frameChildren.push(appCard);
  console.groupEnd();

  console.log("queue exports:", data.exports);
  type ParentNode = AppCard | Shape;
  let componentQueue: Array<[ParentNode, string]> = data.exports.map((id) => [
    appCard,
    id,
  ]);
  while (componentQueue.length > 0) {
    const [parent, id] = componentQueue.shift()!;

    await processNextComponent(parent, id, data);
  }

  for (const jsdoc of data.jsDoc) {
    const component = data.components[jsdoc.parentNodeId];

    const parent =
      (component && (await findComponentShape(component))) ?? appCard;

    const shape = await buildJSDoc(jsdoc, data, parent, frameChildren);
    await connectItems(parent.id, shape.id);
  }

  console.groupEnd();
  console.log("Done building frame");

  await cleanupMoveMarker();
  await miro.board.viewport.zoomTo(frameChildren);
  return null;

  /**
   * I RARELY like to have mutation in my code, because shared mutable state
   * makes things so complicated. This project is one of thoese exceptions where
   * I'm intentionally passing an object through a number of NodeScanners that
   * mutate it.
   *
   * Why bring up mutation? I'm using function histing to define this function
   * after the return statement. I have access to all the local variables
   * defined at the top without the confusion of having this code in the middle
   * of the loops above.
   *
   * I'm not sure if people have strong opinions on whether this is good or bad.
   * I generally prefer to pass immutable state down, get immutable state back
   * and I find it makes it easier to reason about.
   *
   * @AppExplorer
   * @TODO figure out a better way to handle zooming. This is really jumpy.
   */
  async function processNextComponent(
    parent: AppCard | Shape,
    id: string,
    data: ScanData
  ) {
    const currentComponent = data.components[id];
    invariant(currentComponent, () => `Missing component ${id}`);

    const component = await buildComponent(id, data, parent, frameChildren);
    const connector = await connectItems(parent.id, component.id);

    if (data.exports.includes(id)) {
      Object.assign(connector.style, theme.exportLine);
      await connector.sync();
    }
    frameChildren.push(component);
    await miro.board.viewport.zoomTo(frameChildren);
    if ("referencedComponents" in currentComponent) {
      const tmp: typeof componentQueue =
        currentComponent.referencedComponents.map((id) => [component, id]);
      console.log("Queue items:", tmp);
      componentQueue.push(...tmp);
    }
  }
}
