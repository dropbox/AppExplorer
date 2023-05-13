import type { LoaderArgs } from "@remix-run/node";
import { json } from "@remix-run/node"
import { Link, Outlet, useLoaderData } from "@remix-run/react";
import React from "react";
import { useFetcher } from "react-router-dom";

// Files that end in .server are excluded from the browser bundle.
import { requireProject } from "~/lsp/lsp.server";
import type { ApiLsResponse } from "./lsp_.api_.$project_.ls";


export const loader = ({ params }: LoaderArgs) => {
  const [projectName] = requireProject(params);

  return json({
    projectName,
  })
}


export default function () {
  const { projectName } = useLoaderData<typeof loader>()

  return (
    <div className="flex">
      <ul>
        <FileOrDirectory project={projectName} path="" to="file" />
      </ul>

      <div className="flex-1">
        <p className="bg-gray-800 p-3 text-white">
          This is a minimal prototype to launch a TypeScript language server and explore
          its responses.
        </p>
        <Outlet />
      </div>
    </div>
  )
}

function FileOrDirectory({ project, path, to }: { project: string, path: string, to: string }) {
  const [expand, setExpand] = React.useState(path === "")
  const fetcher = useFetcher<ApiLsResponse>();

  React.useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data == null) {
      fetcher.load('/lsp/api/' + project + '/ls?path=' + (path));
    }
  }, [fetcher, path, project]);

  const data = fetcher.data
  if (!data) {
    return <li>{path.split('/').pop()}...</li>
  }

  if ('errors' in data) {
    return (
      <li>
        <div>{path}</div>
        {JSON.stringify(data.errors)}
      </li>
    )
  }

  if (data.type === "directory") {
    return (
      <li>
        <button onClick={() => setExpand(e => !e)}>
          {data.name}
        </button>
        {expand && (
          <ul className="pl-4">
            {data.children.map((child) => (
              <FileOrDirectory key={child} project={project} path={data.path + child} to={to} />
            ))}
          </ul>
        )}
      </li>
    )
  } else {
    return (
      <li>
        <Link to={"/lsp/" + project + "/" + to + data.path}>
          {data.name}
        </Link>
      </li>
    )
  }
}

