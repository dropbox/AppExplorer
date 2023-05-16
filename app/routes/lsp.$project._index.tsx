import type { LoaderArgs } from "@remix-run/node";
import { json } from "@remix-run/node"
import { useLoaderData } from "@remix-run/react";

// Files that end in .server are excluded from the browser bundle.
import { requireProject } from "~/lsp/lsp.server";
import { FileOrDirectory } from "../lsp/components/FileOrDirectory";


export const loader = async ({ params, request }: LoaderArgs) => {
  const [projectName] = await requireProject(params);
  const url = new URL(request.url)
  const path = url.searchParams.get("path") ?? ''

  return json({
    projectName,
    path,
  })
}


export default function () {
  const { projectName } = useLoaderData<typeof loader>()

  return (
    <ul className="flex bg-coconut w-full h-full overflow-auto">
      <FileOrDirectory
        project={projectName}
        path=""
        name={`(${projectName})`}
        type="directory"
        to="./plugin?path=" />
    </ul>
  )
}
