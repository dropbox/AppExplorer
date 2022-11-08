import type { LoaderFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import React from "react";
import invariant from "tiny-invariant";
import type { FileData } from "~/components/ShowFile";
import { ShowFile } from "~/components/ShowFile";
import * as fs from "~/utils/fs.server";

export type DirectoryData = {
  type: "directory";
  path: string;
  files: string[];
};
type AppData = DirectoryData | FileData;

export const loader: LoaderFunction = async ({ params }) => {
  invariant(process.env.REPO_ROOT, "This file requires a REPO_ROOT");

  const path = params["*"] ?? "";

  const fullPath = fs.pathJoin(process.env.REPO_ROOT, path);

  let stat;
  try {
    stat = await fs.stat(fullPath);
  } catch (e) {
    throw new Response(`Not Found: ${fullPath}`, {
      status: 404,
    });
  }

  if (stat.isDirectory()) {
    const files = await fs.readdir(fullPath);
    return json<AppData>({
      type: "directory",
      path,
      files,
    });
  }

  return json<AppData>({
    type: "file",
    path,
  });
};

const sep = "/";

/**
 * BrowseComponent is the entry point for the sidebar in Miro.
 *
 * @AppExplorer https://miro.com/app/board/uXjVOHoOb1g=/?moveToWidget=3458764537984544734
 */
export default function BrowseComponent() {
  const data = useLoaderData<AppData>();
  const { path } = data;

  return (
    <div style={{ maxHeight: "100vh", overflow: "auto" }}>
      <h1>
        <BrowseBreadcrumbs path={path} />
      </h1>

      {data.type === "directory" && <ShowDirectory data={data} path={path} />}

      {data.type === "file" && <ShowFile path={path} />}
    </div>
  );
}

function ShowDirectory(props: { data: DirectoryData; path: string }) {
  return (
    <ul>
      {props.data.files.map((name) => (
        <li key={name}>
          <Link to={`${[props.path, name].filter(Boolean).join("/")}`}>
            {name}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function BrowseBreadcrumbs(props: { path: string }) {
  const f = props.path.split(sep).filter(Boolean);

  return (
    <>
      <Link to="">(root)</Link>/
      {f.map((fragment, i, arr) => (
        <React.Fragment key={i}>
          {i > 0 && "/"}
          {i < arr.length - 1 ? (
            <Link key={i} to={`${arr.slice(0, i + 1).join(sep)}`}>
              {fragment}
            </Link>
          ) : (
            <>{fragment}</>
          )}
        </React.Fragment>
      ))}
    </>
  );
}
