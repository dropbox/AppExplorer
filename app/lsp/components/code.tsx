import React from "react"
import type { LinksFunction } from "@remix-run/node";
import codeStylesheet from './code.css'

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: codeStylesheet },
]

type Props = {
  line?: number
};

export const Code = ({ children, line = 1 }: React.PropsWithChildren<Props>): JSX.Element => {
  if (typeof children === "string") {
    const lines = String(children!).split('\n')
    return Code({
      children: lines.map((line, i) => <span key={i}>{line}</span>),
      line,
    })
  }

  return (
    <div className="bg-graphite p-2 m-2 max-h-[75vh] overflow-auto">
      <code
        className="whitespace-pre text-white flex flex-col"
        style={{
          counterSet: `line ${line - 1}`,
        }}
      >
        {children}
      </code>
    </div>
  )
}