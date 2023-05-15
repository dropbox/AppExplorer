import { useLoaderData, useParams, useSearchParams } from "@remix-run/react";
import { Code, links as codeLinks } from "~/lsp/components/code";
import invariant from "tiny-invariant";
import type { LoaderArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { requireProject } from "~/lsp/lsp.server";
import { fs } from "~/fs-promises.server";
import * as fsPath from "path";
import { MiroShape } from "~/lsp/components/miro-shape";

export const links = codeLinks

export const loader = async ({ params, request }: LoaderArgs) => {
  const [, project] = await requireProject(params);
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
    return json({
      type: 'directory',
      path,
    } as const)
  } else if (stat.isFile()) {
    return json({
      type: "cat",
      path,
      content: await fs.readFile(requestedPath, 'utf-8'),
    } as const);
  } else {
    throw new Response("Path is invalid", { status: 400 })
  }
}

export default function ViewFile() {
  const data = useLoaderData<typeof loader>()
  const params = useParams()
  const [searchParams] = useSearchParams()
  const currentFile = (searchParams.get('path') ?? '')
  const project = params.project
  invariant(project !== undefined, 'project is undefined')


  return (
    <div className="flex">
      <div>
        <div>{currentFile}</div>
        <hr />
        {data?.type === 'cat' && (
          <Code path={data.path}>{data.content}</Code>
        )}
        <MiroShape
          shape='circle'
          content="Hello World"
          meta={{
            path: data.path,
            project,
          }}
          width={70}
          height={30}
        />
      </div>
    </div >
  );
}