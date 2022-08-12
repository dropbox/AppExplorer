import type {
  AppCard,
  Card,
  Connector,
  Frame,
  Shape,
} from "@mirohq/websdk-types";
import { identity } from "~/utils/identity";

export function style<T extends Connector | Shape | AppCard>(
  t: Partial<T["style"]>
) {
  return t;
}

type ConnectorTheme = Partial<Connector["style"]>;
type ShapeTheme = Partial<Shape["style"]>;
type AppCardTheme = Partial<AppCard["style"]>;
type CardTheme = Partial<Card["style"]>;
type FrameTheme = Partial<Frame["style"]>;

/**
 * This object is a type-safe set of theme colors that get applied the board.
 * It's driven by the identity function and telling it what kind of object is
 * being passed in.
 *
 * const identity<T>(t:T) => t
 *
 * // We're going to pass a ShapeTheme into identity, so that's what it's going
 * // to return.If we have mistakes, typos, "numbers" in quotes, TypeScript will
 * // tell me and I'll fix it
 * component: identity<ShapeTheme>({
 *
 * Credit: Lauren House @lhouse for putting together together the colors
 * @TODO: Re-scan the rest of the board to update the TODO theme
 *
 * @AppExplorer
 */
export const theme = {
  defaultLine: identity<ConnectorTheme>({
    strokeColor: "#C2BDB6",
    strokeWidth: 3,
  }),
  exportLine: identity<ConnectorTheme>({
    strokeColor: "#0061FE",
    strokeWidth: 3,
  }),
  component: identity<ShapeTheme>({
    fillColor: "#EEE9E2",
  }),
  card: identity<AppCardTheme>({
    cardTheme: "#B4DC19",
  }),
  todo: identity<CardTheme>({
    cardTheme: "#C8AFF0",
  }),
  jsDoc: identity<ShapeTheme>({
    fillColor: "#B4C8E1",
    textAlign: "left",
  }),
  frame: identity<FrameTheme>({
    fillColor: "#F7F5F2",
  }),
} as const;

// rounded rectangle: #1E1919, text for rounded rectange: FFFFFF
// line indicating things you add to the graph after its generated:
// Start here: rectangle (#0061FE), text: FFFFFF
