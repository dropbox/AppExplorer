import React from "react"
import type { LinksFunction } from "@remix-run/node";
import codeStylesheet from './code.css'
import classNames from "classnames";
import { MiroShape } from "./miro-shape";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: codeStylesheet },
]

type Props = {
  line?: number
  shapeMeta?: {
    projectName: string,
    path: string,
  }
};

export const Code = ({ children, line = 1, shapeMeta }: React.PropsWithChildren<Props>): JSX.Element => {
  const [lineSelection, setLineSelection] = React.useState<number[]>([])

  const selectLine = React.useCallback((line: number) => {
    // Only select lines if this component has metadata for a shape.
    if (!shapeMeta) { return }

    setLineSelection((prev) => {
      const lastSelection = prev[prev.length - 1]
      if (lastSelection == undefined) {
        return [line]
      } else if (lastSelection < line) {
        return [lastSelection, line]
      } else if (lastSelection > line) {
        return [line, lastSelection]
      }
      return []
    })
  }, [shapeMeta])


  const textSelection = React.useMemo(() => {
    if (lineSelection.length === 0) {
      return ''
    }
    const lines = String(children!).split('\n')
    const selectedLines = lines.slice(lineSelection[0], lineSelection[1] + 1)
    return selectedLines.map((l, i) => <p key={i}>{l}</p>)
  }, [lineSelection, children])

  console.log({ lineSelection, textSelection })

  const lines = React.useMemo(() => String(children!).split('\n'), [children])

  return (
    <div className="bg-graphite p-2 m-2 max-h-[75vh] overflow-auto">
      {textSelection.length > 0 && shapeMeta && (
        <MiroShape
          content={textSelection}
          shape="round_rectangle"
          onDrop={(shape) => {
            setLineSelection([])
          }}
          width={300}
          height={150}
          style={{
            textAlign: 'left',
            fontSize: 12,
          }}
          meta={{
            ...shapeMeta,
            lines: lineSelection.join('-'),
          }}
        />
      )}
      {textSelection.length === 0 && (
        <code
          className={classNames("whitespace-pre text-white flex flex-col", {
          })}
          style={{
            counterSet: `line ${line - 1}`,
          }}
        >

          {lines.map((line, i) => (
            <span
              onClick={() => selectLine(i)}
              className={classNames({
                'active': i >= lineSelection[0] && i <= lineSelection[1],
              })}
              key={i}>{line}</span>
          ))}
        </code>
      )}
    </div>
  )
}