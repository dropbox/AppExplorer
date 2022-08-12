import type { LoaderFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import invariant from "tiny-invariant";
import { findProjects } from "~/utils/findProjects";

export interface AppExplorerConfig {
  id: string;
  name: string;
  boardId: string;
  pathRelativeToGit: string;
}

type ProjectData = {
  projects: Array<AppExplorerConfig>;
};

export const loader: LoaderFunction = async () => {
  invariant(process.env.REPO_ROOT, "This file requires a REPO_ROOT");
  const projects = await findProjects(process.env.REPO_ROOT);
  return json<ProjectData>({
    projects,
  });
};

/**
 * While building durring hack week I assumed the root of the git repo and root
 * of the project would be the same. Everything that interacts with the filesystem
 * operates from the repo's root (with the .git folder).
 *
 * This route scans for AppExplorer.json files, which make up the individual
 * "projects" that you can select.
 *
 * @returns
 */
export default function Projects() {
  const { projects } = useLoaderData<ProjectData>();

  return (
    <ul>
      {projects.map((project) => (
        <li key={project.id}>
          <Link to={`/project/${project.id}/`}>{project.name}</Link>
          <div>id: {project.id}/</div>
          <div>path: {project.pathRelativeToGit}/</div>
          <div>boardId: {project.boardId ?? "(None)"}/</div>
        </li>
      ))}
    </ul>
  );
}
