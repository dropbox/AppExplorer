import React from "react";
import { links as codeLinks } from "~/lsp/components/code";
import { LanguageServerProtocol } from "../lsp/components/LanguageServerProtocol";

export const links = codeLinks

export default function () {
  const [selected, setSelected] = React.useState<"" | 'lsp' | 'whoseisit' | 'bzl'>("")

  return (
    <div className="flex flex-col">
      <div className="w-full flex flex-row justify-center">
        <select value={selected} onChange={(e) => setSelected(e.target.value as any)}>
          <option value="">(none)</option>
          <option value="lsp">Language Server Protocol</option>
          <option value="whoseisit">WhoseIsIt</option>
          <option value="bzl">Bzl Query</option>
        </select>
      </div>
      {selected === 'lsp' && <LanguageServerProtocol />}
      {selected === 'whoseisit' && <WhoseIsIt />}
      {selected === 'bzl' && <BzlQuery />}
    </div>
  )
}

function BzlQuery() {

  return (
    <div>
      bzl query
    </div>
  )
}
function WhoseIsIt() {
  return (
    <div>
      whoseisit
    </div>
  )
}

