import type { ActionFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import invariant from "tiny-invariant";
import { linterScanFile } from "~/linter";
import type { BoardPermalink } from "~/linter/at-app-explorer";
import type { JSDocEntry } from "~/scanner/jsdoc-scanner";
import { unique } from "~/utils/unique";

export const action: ActionFunction = async ({ request }) => {
  const formData = await request.formData();
  const projectStr = formData.get("project");
  invariant(typeof projectStr === "string", "project required");
  // const project = JSON.parse(projectStr) as AppExplorerConfig;

  const links = formData.getAll("link");

  const boardPermalinks: Array<BoardPermalink> = links.map((linkStr) => {
    invariant(typeof linkStr === "string");
    const tmp = JSON.parse(linkStr) as NonNullable<JSDocEntry["boardLink"]>;
    invariant(tmp.permalink, "Missing permalink");

    return {
      location: tmp.location,
      permalink: tmp.permalink,
    };
  });

  const uniqueFiles = unique(
    boardPermalinks.map((l) => l.location.split("#L")[0])
  );

  await Promise.all(
    uniqueFiles.map((file) => {
      return linterScanFile(file, boardPermalinks);
    })
  );
  return json({});
};
