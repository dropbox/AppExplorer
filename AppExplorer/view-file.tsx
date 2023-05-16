import { useLoaderData, useSearchParams } from "@remix-run/react";
import { Code, links as codeLinks } from "~/lsp/components/code";
import type { LoaderArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { json } from "@remix-run/node";
import { requireProject } from "~/lsp/lsp.server";
import { fs } from "~/fs-promises.server";
import * as fsPath from "path";

export const links = codeLinks

export const loader = async ({ params, request }: LoaderArgs) => {
  const [projectName, project] = await requireProject(params);
  const url = new URL(request.url)
  const path = url.searchParams.get("path") ?? ''
  if (typeof path !== "string") {
    throw new Response("Path is required", { status: 400 })
  }

  const requestedPath = fsPath.join(project.root, path)
  if (!requestedPath.startsWith(project.root)) {
    throw new Response("Path is invalid", { status: 400 })
  }

  const stat = await fs.stat(requestedPath)

  if (stat.isDirectory()) {
    throw redirect(`/lsp/${projectName}/?path=${path}`)
  } else if (stat.isFile()) {
    return json({
      path,
      projectName,
      content: await fs.readFile(requestedPath, 'utf-8'),
    } as const);
  } else {
    throw new Response("Path is invalid", { status: 400 })
  }
}


export default function ViewFile() {
  const data = useLoaderData<typeof loader>()
  const [searchParams] = useSearchParams()
  const currentFile = (searchParams.get('path') ?? '')


  return (
    <div className="flex">
      <div>
        <div>{currentFile}</div>
        <hr />
        <Code shapeMeta={{
          path: data.path,
          projectName: data.projectName,
        }}>{data.content}</Code>
      </div>
    </div >
  );
}