import * as fs from "fs/promises";
import * as path from "path";
import invariant from "tiny-invariant";
import type { AppExplorerConfig } from "~/routes/projects";

let projectCache: Array<AppExplorerConfig>;
let cacheRoot: string;

export async function findProjects(root: string) {
  if (root === cacheRoot && projectCache) {
    return projectCache;
  }

  const gitFolder = path.join(root, ".git/");
  console.log({ gitFolder });
  const git = await fs.stat(gitFolder);
  invariant(git.isDirectory(), () => `Expected to find .git folder in ${root}`);
  const projectFiles = await scanForConfigFiles(root);

  const projects = await Promise.all(
    projectFiles.map(async (filePath): Promise<AppExplorerConfig> => {
      const json = await fs.readFile(filePath, { encoding: "utf-8" });
      const data = JSON.parse(json);

      const { id, name, boardId, pathRelativeToGit } = data;
      invariant(typeof name === "string", "name is a require config option");

      const config: AppExplorerConfig = {
        id: id || Math.random().toString(36).substring(2),
        name,
        boardId,
        pathRelativeToGit: path.relative(root, path.dirname(filePath)),
      };

      invariant(
        config.id === encodeURIComponent(config.id),
        () =>
          `Expected ID to be URL encoded '${
            config.id
          }' !== '${encodeURIComponent(config.id)}'`
      );

      if (config.pathRelativeToGit !== pathRelativeToGit || config.id !== id) {
        await fs.writeFile(filePath, JSON.stringify(config, undefined, 2));
      }
      return config;
    })
  );
  projectCache = projects;
  cacheRoot = root;
  return projects;
}

export async function scanForConfigFiles(
  folder: string,
  configs: string[] = []
) {
  const files = await fs.readdir(folder);
  for (const filename of files) {
    const file = path.join(folder, filename);
    const stat = await fs.stat(file);
    if (stat.isDirectory()) {
      scanForConfigFiles(file, configs);
    } else if (filename === "AppExplorer.json") {
      configs.push(file);
    }
  }
  return configs;
}
