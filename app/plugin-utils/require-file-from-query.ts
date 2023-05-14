import { json } from "@remix-run/node";
import * as fsPath from "path";
import { fs } from "~/fs-promises.server";
import type { Project } from "~/lsp/lsp.server";

export async function getPathFromQuery(request: Request, project: Project) {
  const url = new URL(request.url);
  const path = url.searchParams.get("path");
  if (typeof path !== "string") {
    throw json(
      { type: "error", errors: { path: "Path is required" } },
      { status: 400 }
    );
  }

  const fullPath = fsPath.join(project.root, path);
  if (!fullPath.startsWith(project.root)) {
    throw json(
      { type: "error", errors: { path: "Path is invalid" } },
      { status: 400 }
    );
  }

  const stat = await fs.stat(fullPath);
  return { path, stat, fullPath };
}
