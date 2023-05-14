import { useLoaderData, useParams } from "@remix-run/react";
import type { DocumentSymbol } from "vscode-languageserver-protocol";
import React from "react";
import { Code } from "~/lsp/components/code";
import invariant from "tiny-invariant";
import type { LoaderArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import * as lspServer from "~/lsp/lsp.server";


export const loader = async ({ params, request }: LoaderArgs) => {
  const [projectName, project] = await lspServer.requireProject(params);
  const url = new URL(request.url)
  const path = url.searchParams.get("path")
  if (typeof path !== "string") {
    throw new Response("Path is required", { status: 400 })
  }

  const fullPath = lspServer.resolvePath(project, path);

  // TODO: Make this more generic, so that I can ask for the connection for a file instead of using
  // a specific language. Right now I'm exploring what I can do with the LSP.
  const connection = await lspServer.getTypescriptConnection();
  const { uri, text: fileContent } = await lspServer.openTextDocument(connection, fullPath);

  // This is a list of top level symbols created in the file. The type is
  // recursive, so this seems to be the module level symbols.
  const symbols = await lspServer.requestDocumentSymbols(connection, uri);

  return json({
    type: 'symbols',
    projectName,
    path,
    fileContent,
    symbols,
  } as const);
};

export const lookupKind = (kind: DocumentSymbol['kind']): string => {
  switch (kind) {
    case 1: return 'File'
    case 2: return 'Module'
    case 3: return 'Namespace'
    case 4: return 'Package'
    case 5: return 'Class'
    case 6: return 'Method'
    case 7: return 'Property'
    case 8: return 'Field'
    case 9: return 'Constructor'
    case 10: return 'Enum'
    case 11: return 'Interface'
    case 12: return 'Function'
    case 13: return 'Variable'
    case 14: return 'Constant'
    case 15: return 'String'
    case 16: return 'Number'
    case 17: return 'Boolean'
    case 18: return 'Array'
    case 19: return 'Object'
    case 20: return 'Key'
    case 21: return 'Null'
    case 22: return 'EnumMember'
    case 23: return 'Struct'
    case 24: return 'Event'
    case 25: return 'Operator'
    case 26: return 'TypeParameter'
    default: return 'Unknown'
  }

}
export default function LanguageServerProtocol() {
  const data = useLoaderData<typeof loader>()
  const params = useParams()
  const project = params.project
  invariant(project !== undefined, 'project is undefined')

  const lines = React.useMemo(() => {
    if (data?.type === 'symbols') {
      return data.fileContent.split('\n')
    }
    return [] as string[]
  }, [data]);

  return (
    <div className="flex">

      <div>
        <div>Symbols found in {data.path}</div>
        <hr />

        {data?.type === 'symbols' && (
          <ul>
            {data.symbols.map((symbol, i) => (
              <SymbolViewer lines={lines} symbol={symbol} key={i} />
            ))}
            {data.symbols.length === 0 && (
              <div>
                No symbols found. Showing source instead.
                <Code>{data.fileContent}</Code>
              </div>
            )}
          </ul>
        )}
      </div>
    </div >
  );
}

function getRange(lines: string[], range: DocumentSymbol['range']) {
  let subset = lines.slice(range.start.line, range.end.line + 1);
  subset[0] = subset[0].slice(range.start.character);
  subset[subset.length - 1] = subset[subset.length - 1].slice(0, range.end.character);
  return subset;
}
function SymbolViewer({ symbol, lines }: { symbol: DocumentSymbol; lines: string[]; }) {
  const source = React.useMemo(
    () => getRange(lines, symbol.range).join('\n'),
    [lines, symbol.range]
  );

  delete symbol.children;

  return (
    <li className="flex items-start m-4 border-black border-2j">
      <div>
        {symbol.name}
        <br />
        (kind: {lookupKind(symbol.kind)})
      </div>
      <Code>{JSON.stringify(symbol, null, 2)}</Code>

      <Code line={symbol.range.start.line}>{source}</Code>
    </li>
  );

}