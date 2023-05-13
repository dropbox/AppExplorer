import type { LoaderArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import * as lspServer from "~/lsp/lsp.server";


export const loader = async ({ params }: LoaderArgs) => {
  const [projectName, project] = lspServer.requireProject(params);
  const requestedPath = params['*'];
  if (!requestedPath) {
    throw new Response("Path is required", { status: 400 });
  }

  const fullPath = lspServer.resolvePath(project, requestedPath);

  // TODO: Make this more generic, so that I can ask for the connection for a file instead of using
  // a specific language. Right now I'm exploring what I can do with the LSP.
  const connection = await lspServer.getTypescriptConnection();
  const { uri, text: fileContent } = await lspServer.openTextDocument(connection, fullPath);

  // This is a list of top level symbols created in the file. The type is
  // recursive, so this seems to be the module level symbols.
  const symbols = await lspServer.requestDocumentSymbols(connection, uri);

  return json({
    projectName,
    path: requestedPath,
    fileContent,
    symbols,
  });
};
