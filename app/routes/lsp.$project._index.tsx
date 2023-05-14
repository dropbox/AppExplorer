import type { LoaderArgs } from "@remix-run/node";
import { json } from "@remix-run/node"
import { NavLink, Outlet, useLoaderData } from "@remix-run/react";

// Files that end in .server are excluded from the browser bundle.
import { requireProject } from "~/lsp/lsp.server";
import { FileOrDirectory } from "../lsp/components/FileOrDirectory";
import classNames from "classnames";
import { fs } from "~/fs-promises.server";
import * as fsPath from 'path'
import invariant from "tiny-invariant";


export const loader = async ({ params, request }: LoaderArgs) => {
  const [projectName] = await requireProject(params);
  const url = new URL(request.url)
  const path = url.searchParams.get("path") ?? ''

  const routeFiles = await fs.readdir(fsPath.join(__dirname, '../app/routes'))

  const plugins = routeFiles.filter(file =>
    file !== 'lsp.$project.tsx'
    && (
      file.startsWith(`lsp.plugin.${projectName}.`)
      || file.startsWith(`lsp.$project.`)
    )
  ).flatMap(pluginFilename => {
    const parts = pluginFilename.split('.')
    console.log(parts)
    invariant(parts.shift() === 'lsp', 'Expected to start with lsp')
    invariant(parts.shift() === '$project', 'Missing $project')
    invariant(parts.pop() === 'tsx', 'Expected to end with tsx')
    if (parts[0] === 'plugin') {
      parts.shift()
      return {
        name: parts.join('.'),
        path: parts.join('/'),
      }
    }
    return []
  })

  return json({
    projectName,
    path,
    tabs: plugins,
  })
}


export default function () {
  const { projectName, path, tabs } = useLoaderData<typeof loader>()

  if (path) {
    return (
      <div className="flex-1">
        <nav className='p-1 flex flex-row gap-1'>
          {tabs.map(tab => (
            <Tab key={tab.name} to={`./${tab.path}?path=${path}`}>{tab.name}</Tab>
          ))}
        </nav>
        <Outlet />
      </div>
    )


  }


  return (
    <div className="flex">
      <ul className="bg-coconut w-full">
        <FileOrDirectory
          project={projectName}
          path=""
          name={`(${projectName})`}
          type="directory"
          to="./plugin?path=" />
      </ul>
      {path}

    </div>
  )
}

function Tab({ to, children }: React.PropsWithChildren<{ to: string }>) {
  return (
    <NavLink
      className={({ isActive }) => classNames('border-b-2', {
        'border-g-zen': isActive
      })}
      to={to}>
      {children}
    </NavLink>
  )
}


export function CatchBoundary() {
  // const params = useParams();
  return (
    <div>
      <h2>We couldn't find that page!</h2>
    </div>
  );
}
