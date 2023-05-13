import { useFetcher, useLoaderData, useParams } from "@remix-run/react";
import type { DocumentSymbol } from "vscode-languageserver-protocol";
import React from "react";
import { Code } from "~/lsp/components/code";
import type { loader } from "../../routes/lsp_.api_.$project_.symbols";
import invariant from "tiny-invariant";
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
export function LanguageServerProtocol() {
  // const { symbols, fileContent, path } = useLoaderData<typeof loader>();
  const lines = React.useMemo(() => fileContent.split("\n"), [fileContent]);
  const fetcher = useFetcher<typeof loader>()

  const params = useParams()
  const currentFile = '/' + params['*']
  const project = params.project
  invariant(project !== undefined, 'project is undefined')


  React.useEffect(() => {
    if (fetcher.state === "idle"
      && fetcher.data === undefined
    ) {
      fetcher.load('/lsp/api/' + project + '/ls?path=' + (currentFile));
    }
  }, [currentFile, fetcher, project]);
  const data = fetcher.data;

  return (
    <div className="flex">

      <div>
        <div>Symbols found in {currentFile}</div>
        <hr />

        {fetcher.state === "loading" && (
          <div>Loading...</div>
        )}
        {fetcher.data && (

          <ul>
            {fetcher.data.symbols.map((symbol, i) => (
              <SymbolViewer lines={lines} symbol={symbol} key={i} />
            ))}
            {fetcher.data.symbols.length === 0 && (
              <div>
                No symbols found. Showing source instead.
                <Code>{fetcher.data.fileContent}</Code>
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
