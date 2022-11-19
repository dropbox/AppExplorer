import type { LinksFunction, MetaFunction } from "@remix-run/node";
import {
  Links,
  LiveReload,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "@remix-run/react";

/**
 * Tailwind is currently disabled because it removes ALL the styles including
 * buttons.  I haven't wanted to work on a theme yet, so everything is mostly
 * unstyled HTML.
 *
 * @AppExplorer
 */
// import styles from "./tailwind.css";

export const links: LinksFunction = () => [
  // { rel: "stylesheet", href: styles },
];

export const meta: MetaFunction = () => ({
  charset: "utf-8",
  title: "App Explorer",
  viewport: "width=device-width,initial-scale=1",
});

export default function App() {
  return (
    <html lang="en">
      <head>
        <Meta />
        <script src="https://miro.com/app/static/sdk/v2/miro.js"></script>
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
        <LiveReload />
      </body>
    </html>
  );
}
