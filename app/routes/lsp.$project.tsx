import type { LoaderArgs } from "@remix-run/node";
import { json } from "@remix-run/node"
import { Outlet, useLoaderData } from "@remix-run/react";

// Files that end in .server are excluded from the browser bundle.
import { requireProject } from "~/lsp/lsp.server";
import { FileOrDirectory } from "../lsp/components/FileOrDirectory";


export const loader = ({ params }: LoaderArgs) => {
  const [projectName] = requireProject(params);

  return json({
    projectName,
  })
}


export default function () {
  const { projectName } = useLoaderData<typeof loader>()

  return (
    <div className="flex ">
      <ul className="bg-coconut">
        <FileOrDirectory
          project={projectName}
          path=""
          name={`(${projectName})`}
          type="directory"
          to="file" />
      </ul>

      <div className="flex-1">
        <p className="bg-dropboxBlue text-coconut">
          This is a minimal prototype to launch a TypeScript language server and explore
          its responses.
        </p>
        <Outlet />
      </div>
    </div>
  )
}


