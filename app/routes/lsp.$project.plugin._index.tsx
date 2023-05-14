import type { LoaderArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node"
import { requireProject } from "~/lsp/lsp.server";
import { getPathFromQuery } from "~/plugin-utils/require-file-from-query";

export const loader = async ({ params, request }: LoaderArgs) => {
  const [, project] = await requireProject(params);
  const path = await getPathFromQuery(request, project)

  const url = new URL('./plugin/AppExplorer/view-file', request.url)
  url.searchParams.set('path', path.path)

  return redirect(url.toString())
}