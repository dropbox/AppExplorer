import React from "react"


export const Code = ({ children }: React.PropsWithChildren<{}>) => {

  return (
    <div className="bg-black p-2 m-2 max-h-[75vh] overflow-auto">
      <code className="whitespace-pre text-white">{children}</code>
    </div>
  )
}