import type { AppCard, Item, Shape } from "@mirohq/websdk-types";
import type { ScanData } from "./index";
import { findSpace } from "./findSpace";
import { theme } from "./theme";
import { makePermalink } from "./permalinks";

export async function findComponentShape(
  component: ScanData["components"][number]
) {
  let nameTag = `&lt;${component.name}`;
  let pathTag: string;
  if ("meta" in component) {
    pathTag = `<p>${component.meta.path}<p>`;
  }

  const isSameComponent = (s: Shape) => {
    if (s.shape === "hexagon") {
      if ("meta" in component && pathTag) {
        if (!s.content.includes(pathTag)) {
          return false;
        }
      }
      const lines = s.content.split("<p>", 2);
      return lines[1].includes(nameTag + "<"); // Adding the `<` to make sure it's the full tag name
    }
    return false;
  };

  const shapes = await miro.board.get({
    type: "shape",
  });
  return shapes.find(isSameComponent);
}

/**
 * I'm not trying to output a fully ready-to-present graph. I'm building a tool
 * for gradual and incremental documentation and planning. So I have these couple things
 * to try to re-use the same shape between runs
 *
 * 1.  let nameTag = `&lt;${component.name}`;
 * Personal coding style, I like to use `<` as puncutation for `<ComponentNames`
 * This is expected to be on the first line of the shape
 *
 * 2.  pathTag = `<p>${component.meta.path}<p>`;
 * This tries to make the component unique to this file. As I'm writing this, I
 * realize that isn't working for the Link component at the moment.
 *
 *
 * @AppExplorer Hello World
 */
export async function buildComponent(
  id: string,
  data: ScanData,
  parentNode: Shape | AppCard,
  frameChildren: Array<Item>
) {
  console.group("buildComponent " + id);
  const component = data.components[id];

  const newLine = `<p></p>`;
  let nameTag = `&lt;${component.name}`;
  let pathTag: string;

  let content = `<p>${nameTag}<p>`;
  if (data.remote && data.hash) {
    if ("location" in component) {
      const permalink = makePermalink(
        data.remote,
        data.hash,
        component.location
      );
      content = `<p><a href="${permalink}" target="_blank">&lt;${component.name}</a></p>`;
    } else if ("definitionLocation" in component) {
      const permalink = makePermalink(
        data.remote,
        data.hash,
        component.definitionLocation
      );
      content = `<p><a href="${permalink}" target="_blank">&lt;${component.name}</a></p>`;
    }
  }

  if ("meta" in component) {
    content += `<p>${component.meta.documentation}</p>`;
    content += newLine;
    content += `<p>Type: ${component.meta.type}</p>`;
    content += newLine;
    pathTag = `<p>${component.meta.path}<p>`;
    content += pathTag;
  }
  let shape = await findComponentShape(component);

  const estimatedNumberOfLines = content.split("<p>").length;

  if (!shape) {
    const width = 250;
    const height = 20 + 20 * estimatedNumberOfLines;

    const defaultLocation = await findSpace(
      {
        x: parentNode?.x ?? 0,
        y: parentNode?.y ?? 0,
        width,
        height,
      },
      null,
      id,
      frameChildren
    );

    const newShape = await miro.board.createShape({
      content,
      shape: "hexagon",
      // x: 0,
      // y: 0,
      width,
      height,
      x: defaultLocation.x,
      y: defaultLocation.y,
      style: {
        ...theme.component,
      },
    });
    shape = newShape;
  }
  shape.content = content;
  // f.height = 20 + (20 * estimatedNumberOfLines)
  await shape.sync();
  console.groupEnd();
  return shape;
}
