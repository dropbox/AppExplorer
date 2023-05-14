import type { LoaderArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { getProjects } from "~/lsp/projects";

export const loader = async (a: LoaderArgs) => {
  return json({ projects: await getProjects() })
}

export default function () {
  const data = useLoaderData<typeof loader>()

  return (
    <div>
      <h1>Language Server Protocol Explorer</h1>
      <p>
        This is a tool to explore the Language Server Protocol. It is a work in
        progress. My plan is to figure out what I can do with the LSP and then
        integrate it into AppExplorer. Interacting at the LSP protocol means I
        can make this work for any language.
      </p>

      <p>
        The following projects are available for exploration:
      </p>

      <ul>
        {Object.keys(data.projects).map((projectName) => (
          <li key={projectName}>
            <Link to={"./" + projectName}>{projectName}</Link>
          </li>
        ))}
      </ul>

    </div>
  )
}