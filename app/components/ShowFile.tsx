import { useFetcher } from "@remix-run/react";
import React from "react";
import invariant from "tiny-invariant";
import { JSDoc, StringLiteralLike } from "typescript";
import type { ScanData } from "~/chart";
import { getAppExplorerCard } from "~/chart/buildAppExplorerCard";
import { makePermalink } from "~/chart/permalinks";
import { buildModuleFrame } from "~/chart/buildModuleFrame";
import { links } from "~/root";
import type { AppExplorerConfig } from "~/routes/projects";
import type { JSDocEntry } from "~/scanner/jsdoc-scanner";
export type FileData = {
  type: "file";
  path: string;
  project?: AppExplorerConfig;
};

/**
 * This calls /api/scanFile?path= to asynchronously load the results of the
 * scan.
 *
 * @AppExplorer
 */
export function ShowFile(props: { path: string; project: AppExplorerConfig }) {
  const fetcher = useFetcher<ScanData>();

  React.useEffect(() => {
    console.log("Checking fetcher...", fetcher.state);
    if (fetcher.state === "idle" && !fetcher.data) {
      let path = props.path;
      if (props.project && props.project.pathRelativeToGit) {
        path = props.project.pathRelativeToGit + "/" + path;
      }
      fetcher.load(`/api/scanFile?path=${path}`);
    }
  }, [fetcher, props.path, props.project]);
  const data = fetcher.data;

  if (!data) {
    return <div>Loading data for {props.path}...</div>;
  }

  const exportedComponents = data.exports.map((id) => ({
    id,
    component: data.components[id],
  }));

  return (
    <div>
      <BuildFrameButton data={data} path={props.path} project={props.project} />
      Exports:
      <ol>
        {exportedComponents.map(({ id, component }) => (
          <li key={id}>
            &lt;{component.name}{" "}
            {"location" in component && `(${component.location})`}
            {"referencedComponents" in component && (
              <ul>
                {component.referencedComponents.map((id) => (
                  <li key={id}>&lt;{data.components[id].name}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
      <p>Total components: {Object.keys(data.components).length}</p>
      JSDoc:
      <ul>
        {data.jsDoc.map((a) => (
          <li key={a.location}>
            {a.parentNodeId}
            {a.key}
            <pre>
              {a.comment.split("\n").map((c, i) => (
                <p key={i}>{c}</p>
              ))}
            </pre>
          </li>
        ))}
      </ul>
      <details>
        <summary>JSON</summary>
        <pre>{JSON.stringify(data, undefined, 2)}</pre>
      </details>
    </div>
  );
}

function UpdatePermalinks({
  boardLinks,
  remote,
  hash,
  project,
}: {
  remote: string;
  hash: string;
  boardLinks: Array<NonNullable<JSDocEntry["boardLink"]>>;
  project: AppExplorerConfig;
}) {
  const fetcher = useFetcher();
  const formRef = React.useRef(null);

  const didPermalinksChange = React.useMemo(
    () => boardLinks.length > 0,
    [boardLinks]
  );

  invariant(
    boardLinks.every(function hasPermalink<T extends { permalink?: string }>(
      value: T
    ): value is T & { permalink: "string" } {
      return value && typeof value.permalink === "string";
    })
  );
  React.useEffect(() => {
    if (boardLinks.length > 0) {
      const formData = new FormData();

      formData.set("project", JSON.stringify(project));
      boardLinks.forEach((link) => {
        formData.append("link", JSON.stringify(link));
      });

      fetcher.submit(formData, {
        method: "post",
        action: "/api/updateBoardLinks",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardLinks]);

  return (
    <div>
      {fetcher.state === "submitting" && <div>Updating permalinks...</div>}
      {fetcher.state === "idle" && boardLinks.length > 0 && (
        <div>Updated permalinks...</div>
      )}
      <ul>
        <ul>
          {boardLinks.map((jsDoc) => (
            <li key={jsDoc.location!}>
              <p>
                <a
                  target="_blank"
                  href={makePermalink(remote, hash, jsDoc.location)!}
                  rel="noreferrer"
                >
                  {jsDoc.location}
                </a>
              </p>
              <p>{jsDoc.permalink}</p>
              <input
                type="hidden"
                name={jsDoc.location}
                value={jsDoc.permalink}
              />
            </li>
          ))}
        </ul>
      </ul>
    </div>
  );
}

function cloneAppExplorerTags(jsDoc: Array<JSDocEntry>) {
  const empty: Array<NonNullable<JSDocEntry["boardLink"]>> = [];
  return jsDoc.flatMap((doc): NonNullable<JSDocEntry["boardLink"]>[] => {
    if (doc.boardLink != null) {
      const ae = { ...doc.boardLink };

      return [ae];
    }
    return empty;
  });
}

/**
 * I made this its own component for it to handle its own state. It calls out to
 * buildModuleFrame(data, path) to interact with the board.
 */
function BuildFrameButton({
  data,
  path,
  project,
}: {
  project: AppExplorerConfig;
  data: ScanData;
  path: string;
}) {
  const [permalinksToUpdate, setPermalinks] = React.useState<Array<JSDocEntry>>(
    []
  );
  type Loading = { type: "loading" };
  type Idle = { type: "idle"; hasCard: boolean };
  type Processing = { type: "processing" };
  type Error = { type: "error"; error: string };

  const [state, setState] = React.useState<Loading | Idle | Processing | Error>(
    { type: "loading" }
  );

  const createFrame = React.useCallback(async () => {
    setState({ type: "processing" });
    try {
      const before = cloneAppExplorerTags(data.jsDoc);

      await buildModuleFrame(data, path, project);

      const after = cloneAppExplorerTags(data.jsDoc).filter((v, index) => {
        const original = before[index]!;
        return v.permalink !== original.permalink;
      });
      console.log("setPermalinks", after);
      setPermalinks(after);
      setState({ type: "idle", hasCard: true });
    } catch (e) {
      console.error(e);
      setState({
        type: "error",
        // @ts-ignore
        error: e.message,
      });
    }
  }, [data, path, project]);
  React.useEffect(() => {
    if (state.type === "loading") {
      console.log("getAppExplorerCard", path);

      async function run() {
        try {
          await Promise.race([
            new Promise((res, rej) =>
              setTimeout(() => {
                rej(new Error("Timeout finding AppCard for" + path));
              }, 1000)
            ),
            getAppExplorerCard(path, project).then((card) => {
              setState({
                type: "idle",
                hasCard: card != null,
              });
              return card != null;
            }),
          ]);
        } catch (e) {
          console.error(e);
          setState({
            type: "idle",
            hasCard: false,
          });
        }
      }
      run();
    }
  }, [path, project, state.type]);

  let btnText = "Looking for an existing card...";
  if (state.type === "idle") {
    btnText = state.hasCard ? "Update card" : "Create Card";
  }
  if (state.type === "processing") {
    btnText = "building...";
  }
  if (state.type === "error") {
    btnText = "Try again";
  }

  return (
    <div>
      <button
        onClick={createFrame}
        className="button"
        disabled={state.type !== "idle"}
      >
        {btnText}
      </button>
      {state.type === "error" && <div>{state.error}</div>}
      <UpdatePermalinks
        remote={data.remote}
        hash={data.hash}
        project={project}
        boardLinks={permalinksToUpdate}
      />
    </div>
  );
}
