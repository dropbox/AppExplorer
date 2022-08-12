import type { LinksFunction, MetaFunction } from "@remix-run/node";
import {
  Links,
  LiveReload,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "@remix-run/react";

// import styles from "./tailwind.css";

export const links: LinksFunction = () => [
  // I'm not using this at the moment because it removes the styles on my
  // buttons.  I don't want to deal with making up button styles, so I'll just
  // skip this for now and write the CSS I need.
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
