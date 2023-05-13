import { Link, useLocation, useMatches, useParams } from "@remix-run/react";
import React from "react";
import { useFetcher } from "react-router-dom";
import type { ApiLsResponse } from "../../routes/lsp_.api_.$project_.ls";
import classNames from "classnames";

type FileOrDirectoryProps = {
  type: 'file' | 'directory';
  project: string;
  path: string;
  name: string;
  to: string;
};
export function FileOrDirectory({ type, project, path, to, name }: FileOrDirectoryProps) {
  const params = useParams()
  const currentFile = '/' + params['*']
  const isActive = currentFile.startsWith(path);
  const [expand, setExpand] = React.useState(path === "" || isActive);
  const fetcher = useFetcher<ApiLsResponse>();

  React.useEffect(() => {
    if (fetcher.state === "idle"
      && type === 'directory'
      && expand
      && fetcher.data === undefined
    ) {
      fetcher.load('/lsp/api/' + project + '/ls?path=' + (path));
    }
  }, [expand, fetcher, path, project, type]);
  const data = fetcher.data;

  if (type === 'file') {
    return (
      <li className={classNames(
        "before:content-['_📄']",
        {
          "bg-dropboxBlue": isActive,
          "text-coconut": isActive,
        }
      )} >
        <Link to={"/lsp/" + project + "/" + to + path}>
          {name}
        </Link>
      </li>
    );
  } else if (type === "directory") {
    return (
      <li
        className={classNames('directory block', {
          "before:content-['_📁']": expand === false,
          "before:content-['_📂']": expand === true,
          "bg-dropboxBlue": isActive,
          "text-coconut": isActive,
        })}
        onClick={(event) => {
          event.stopPropagation();
          setExpand(e => !e)
        }
        }
      >
        {name} /
        {expand && data?.type === 'directory' && (
          <ul className={classNames(
            "pl-4",
            'bg-coconut',
            'text-graphite'
          )}>
            {data.children.map((child) => (
              <FileOrDirectory
                key={child.name}
                type={child.type}
                name={child.name}
                project={project}
                path={data.path + child.name}
                to={to} />
            ))}
          </ul>
        )}
      </li >
    );
  }
  return null
}
