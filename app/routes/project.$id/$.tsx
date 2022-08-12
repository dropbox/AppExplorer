import type { LoaderFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import React from "react";
import invariant from "tiny-invariant";
import type { FileData } from "~/components/ShowFile";
import { ShowFile } from "~/components/ShowFile";
import { findProjects } from "~/utils/findProjects";
import * as fs from "~/utils/fs.server";
import type { AppExplorerConfig } from "../projects";

export type DirectoryData = {
  type: "directory";
  path: string;
  files: string[];
};
type AppData = (DirectoryData | FileData) & {
  project: AppExplorerConfig;
};

export const loader: LoaderFunction = async ({ params }) => {
  invariant(process.env.REPO_ROOT, "This file requires a REPO_ROOT");
  const projectId = params["id"];
  invariant(typeof projectId === "string", "$id required");
  const allProjects = await findProjects(process.env.REPO_ROOT);

  const project = allProjects.find((config) => config.id === projectId);
  if (!project) {
    throw new Response(`Project not found ${projectId}`, {
      status: 404,
    });
  }
  const path = params["*"] ?? "";

  const fullPath = fs.pathJoin(
    process.env.REPO_ROOT,
    project.pathRelativeToGit,
    path
  );
  console.log({ fullPath });

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
      project,
      type: "directory",
      path,
      files,
    });
  }

  return json<AppData>({
    project,
    type: "file",
    path,
  });
};

const sep = "/";

export default function BrowseComponent() {
  const data = useLoaderData<AppData>();
  const { path, project } = data;

  return (
    <div style={{ maxHeight: "100vh", overflow: "auto" }}>
      <h1>
        <BrowseBreadcrumbs path={path} project={project} />
      </h1>

      {data.type === "directory" && (
        <ShowDirectory data={data} path={path} project={project} />
      )}

      {data.type === "file" && <ShowFile path={path} project={project} />}
    </div>
  );
}

function ShowDirectory(props: {
  data: DirectoryData;
  path: string;
  project: AppExplorerConfig;
}) {
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

function BrowseBreadcrumbs(props: {
  path: string;
  project: AppExplorerConfig;
}) {
  const f = props.path.split(sep).filter(Boolean);

  return (
    <>
      <Link to="">{props.project.name}</Link>/
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
