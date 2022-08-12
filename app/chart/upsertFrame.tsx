import { theme } from "./theme";

export type FrameProps = {
  path: string;
  x: number;
  y: number;
  width: number;
  height: number;
  childrenIds: Array<string>;
};

export async function upsertFrame({
  path: title,
  x,
  y,
  width,
  height,
  childrenIds,
}: FrameProps) {
  const frames = await miro.board.get({
    type: "frame",
  });
  console.log("frames", frames.length);
  let f = frames.find((f) => f.title === title);
  if (!f) {
    f = await miro.board.createFrame({
      title,
      style: theme.frame,
      x,
      y,
      width,
      height,
    });
  } else {
    f.title = title;
    f.x = x;
    f.y = y;
    f.width = width;
    f.height = height;
  }
  f.childrenIds = childrenIds;
  await f.sync();

  return f;
}
