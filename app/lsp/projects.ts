import path from "path";
import type { Project } from "./lsp.server";
import invariant from "tiny-invariant";
import { fs } from "~/fs-promises.server";

const LSPProjects: Record<Project["name"], Project> = {};

export async function getProjects() {
  const projects = LSPProjects;

  const project = await prepareProject(path.join(__dirname, "../"));
  if (project) {
    LSPProjects[project.name] = project;
  }

  const REPO_ROOT = process.env.REPO_ROOT;

  // if REPO_ROOT contains an AppExplorer.json, read the file and add it to LSPProjects
  if (typeof REPO_ROOT === "string") {
    const project = await prepareProject(REPO_ROOT);
    if (project) {
      LSPProjects[project.name] = project;
    }
  }

  return projects;
}
async function prepareProject(projectRoot: string) {
  const appExplorerJsonPath = path.join(projectRoot, "AppExplorer.json");

  let stat;
  try {
    stat = await fs.stat(appExplorerJsonPath);
  } catch (e) {
    return;
  }
  if (stat.isFile()) {
    const projectConfig = JSON.parse(
      await fs.readFile(appExplorerJsonPath, "utf8")
    );
    invariant(
      typeof projectConfig.name === "string",
      "expected a name in AppExplorer.json"
    );
    invariant(
      typeof projectConfig.root === "string",
      "expected a root in AppExplorer.json"
    );

    const pluginFolder = path.resolve(projectRoot, "AppExplorer");

    let plugins: Project["plugins"] = [];
    if ((await fs.stat(pluginFolder)).isDirectory()) {
      plugins = await readPlugins(projectConfig.name, pluginFolder);
    }

    return {
      name: projectConfig.name,
      root: path.resolve(projectRoot, projectConfig.root),
      plugins,
    };
  }
}

async function readPlugins(projectName: string, pluginFolder: string) {
  const files = await fs.readdir(pluginFolder);

  const plugins = files.map((filename) => {
    if (filename.match(/\.tsx$/)) {
      return filename;
    }
    return [];
  });

  // I can't import the plugins from where they sit, so I'm going to copy them
  // into the lsp folder
  return Promise.all(
    plugins.flat().map(async (plugin): Promise<string> => {
      const source = path.join(pluginFolder, plugin);
      const destination = path.join(
        __dirname,
        "../app/routes",
        `lsp.$project.plugin.${projectName}.${plugin}`
      );

      await fs.mkdir(path.dirname(destination), { recursive: true });

      try {
        const destinationStats = await fs.stat(destination);
        const sourceStats = await fs.stat(source);
        // Only copy the file if the source is older, because this updates the
        // app directory and triggers a reload. Without this timestamp check, it
        // gets stuck in an infinite loop
        if (
          destinationStats.isFile() &&
          sourceStats.mtimeMs < destinationStats.mtimeMs
        ) {
          if (destinationStats.mtimeMs > sourceStats.mtimeMs + 60000) {
            console.log("Saving updates to", source);
            await fs.copyFile(destination, source);
          } else {
            console.log("Plugin already installed, skipping");
          }
          return `${projectName}.${plugin}`;
        }
      } catch (e) {
        // ignore
      }

      console.log("copying file");
      await fs.copyFile(source, destination);
      return `${projectName}.${plugin}`;
    })
  );
}

export async function readInstalledPlugins(projectName: string) {
  const files = await fs.readdir(path.join(__dirname, "../app/routes/"));

  const plugins = files
    .filter((filename) => filename.startsWith(`lsp.plugin.${projectName}.`))
    .map((filename) => {
      const [, , , pluginName] = filename.split(".");
      return {
        projectName,
        pluginName,
        filename,
      };
    });

  return plugins;
}
