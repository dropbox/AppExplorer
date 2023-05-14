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
    <div className="bg-coconut text-c-ocean ">
      <p>
        The following projects are available for exploration:
      </p>

      <div className="flex flex-col max-w-md">
        {Object.keys(data.projects).map((projectName) => (
          <Link
            key={projectName}
            className="rounded-full bg-c-ocean text-coconut px-4 py-2 m-2"
            to={"./" + projectName}>
            {projectName}
          </Link>
        ))}
      </div>

    </div>
  )
}