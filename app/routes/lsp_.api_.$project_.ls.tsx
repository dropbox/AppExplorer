import type { LoaderArgs, TypedResponse } from "@remix-run/node";
import { json } from "@remix-run/node"
import { requireProject } from "~/lsp/lsp.server";
import * as fsPath from 'path'
import * as fs from "fs/promises";


type DirectoryResponse = {
  type: 'directory',
  // All directories end in a slash
  path: `${string}/`,
  name: string,
  children: Array<string>
}
type FileResponse = {
  type: 'file',
  path: string,
  name: string,
}

export type ApiLsResponse = DirectoryResponse | FileResponse | { errors: { path: string } }

const bannedFolders = [
  // Don't open node_modules, it's too big
  'node_modules',
]
const isAllowed = (name: string) => {
  if (bannedFolders.some(f => name.includes(f))) {
    return false
  }
  return true
}

export const loader = async ({ params, request }: LoaderArgs): Promise<TypedResponse<ApiLsResponse>> => {
  const [, project] = requireProject(params);
  const url = new URL(request.url)
  const path = url.searchParams.get("path")
  if (typeof path !== "string") {
    return json({ errors: { path: "Path is required" } }, { status: 400 });
  }

  const requestedPath = fsPath.join(project.root, path)
  if (!requestedPath.startsWith(project.root)) {
    return json({ errors: { path: "Path is invalid" } }, { status: 400 });
  }

  const stat = await fs.stat(requestedPath)
  const name = fsPath.basename(path)

  if (stat.isDirectory()) {
    const children = (await fs.readdir(requestedPath)).filter(isAllowed)

    return json({
      type: "directory",
      path: `${path}/`,
      name,
      children,
    } as const);
  } else if (stat.isFile()) {
    return json({
      type: "file",
      path,
      name,
    } as const);
  } else {
    return json({ errors: { path: "Path is invalid" } }, { status: 400 });
  }
}

