import type { LoaderFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { updateMarkdown } from "~/markdown-index/remarkdown";

export const loader: LoaderFunction = async () => {
  const md = await updateMarkdown({
    boardId: Math.random().toString(36),
    config: {
      ignoredModules: [`import { Link } from "@remix-run/react";`],
    },
    index: {
      abc: {
        name: "Home",
        path: "src/routes/home.tsx",
      },
    },
    projects: {
      example: {
        boardId: "ABC",
        path: "example/Example.AppExplorer.md",
      },
    },
  });

  const data = { md };
  console.log(md);
  return json(data);
};

export default function () {
  const data = useLoaderData();

  return <code>{JSON.stringify(data)}</code>;
}
