import type { Root, Text } from "mdast";
import type { Plugin } from "unified";

declare module "vfile" {
  interface DataMap {
    appExplorer: AppExplorerData;
  }
}

type AppExplorerData = {
  boardId?: string;
  config: {
    ignoredModules: Array<string>;
  };
  index: Record<
    string,
    {
      name: string;
      path: string;
    }
  >;
  projects: Record<
    string,
    {
      boardId: string;
      path: string;
    }
  >;
};

export const updateMarkdownConfig: Plugin<[AppExplorerData], Root> = (data) => {
  return async function (tree, file, next) {
    const { visit } = await import("unist-util-visit");
    const { selectAll, select } = await import("unist-util-select");

    file.data;

    let section: keyof AppExplorerData | "" = "";
    visit(tree, ["heading", "listItem"], (node, index, parent) => {
      if (section == "config" && node.type === "listItem") {
        if (node.children.length === 1) {
          const text = select("text", node) as Text | null;
          if (text) {
            const match = text.value.match(/boardId:(.*)/);
            if (match) {
              const currentValue = match[1].trim();
              if (currentValue !== data.boardId) {
                text.value = `boardId: ${data.boardId}`;
              }
            }
          }
        }

        selectAll("inlineCode");
        console.log(index, node);
      }

      if (node.type === "heading") {
        visit(node, ["text"], (textNode) => {
          if (textNode.type === "text") {
            switch (textNode.value.trim()) {
              case "Config": {
                section = "config";
                break;
              }
            }
          }
        });
      }
    });

    next(null, tree);
  };
};

const header = `
# What is this file?

AppExplorer is an app for documenting and drawing information about a project.
It's main target is a Miro board, but it uses this markdown file as an index.
That produces a useful (local) guide to points of interest, but for way more
context, checkout the Miro board and how those points connect.
`.trim();

const defaultTemplate = (data: AppExplorerData) => {
  const linkImport = `import { Link } from "@remix-run/react";`;

  return `
${header}

# Config
- boardId: ${data.boardId}
- ignoredImports
  - \`${linkImport}\`

# Index
# Projects
`.trim();
};
export async function updateMarkdown(
  data: AppExplorerData,
  md = defaultTemplate(data)
) {
  const { remark } = await import("remark");
  const processor = remark();

  const file = await processor.use(updateMarkdownConfig, data).process(md);

  console.log(file.data.appExplorer);

  return file.toString();
}
