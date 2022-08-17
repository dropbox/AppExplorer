import invariant from "tiny-invariant";
import type { JSDocReport } from "~/scanner/jsdoc-scanner";

export type MarkdownData = {
  projects: Array<MDLink>;
  files: Array<MDFileIndex>;
};

export type MDLink = {
  name: string;
  location: string;
};

export type MDFileIndex = {
  filename: string;
  items: Array<MDLink>;
};

const header = `
# What is this file?

AppExplorer is an app for documenting and drawing information about a project.
It's main target is a Miro board, but it uses this markdown file as an index.
That produces a useful (local) guide to points of interest, but for way more
context, checkout the Miro board and how those points connect.
`.trim();
export function generateMarkdown({ projects, files }: MarkdownData) {
  return `${header}

# INDEX

${files.map(makeFileIndex)}

# SUB-PROJECTS

${projects.map((p) => makeLink(p))}
`;
}

export function readMarkdown(md: string): MarkdownData {
  const files: Array<MDFileIndex> = [];
  const projects: Array<MDLink> = [];
  const [, data] = md.split("# INDEX");
  const [strIndex, strProjects] = data.split("# SUB-PROJECTS");

  let currentFile: MDFileIndex;
  strIndex.split("\n").forEach((line) => {
    const fileMatch = line.match(/- (.*)/);
    const linkMatch = line.match(/- \[(.*)\]\((.*)\)/);

    if (linkMatch) {
      invariant(currentFile);

      currentFile.items.push({
        name: linkMatch[1],
        location: linkMatch[2],
      });
    } else if (fileMatch) {
      currentFile = {
        filename: fileMatch[1],
        items: [],
      };
      files.push(currentFile);
    }
  });

  strProjects.split("\n").forEach((line) => {
    const linkMatch = line.match(/- \[(.*)\]\((.*)\)/);
    if (linkMatch) {
      projects.push({
        name: linkMatch[1],
        location: linkMatch[2],
      });
    }
  });

  return { files, projects };
}

export function makeIndexFromReport(report: JSDocReport): Array<MDFileIndex> {
  let index: Array<MDFileIndex> = [];
  index = report.jsDoc.reduce((index, item) => {
    const [filename] = item.location.split("#L");
    let tmp = index[index.length - 1];

    if (!tmp || tmp.filename !== filename) {
      tmp = {
        filename,
        items: [],
      };
    }
    tmp.items.push({
      name: item.location,
      location: item.location,
    });
    return index;
  }, index);

  return index;
}

const makeLink = (i: MDFileIndex["items"][number]) =>
  `- [${i.name}](${i.location})\n`;

const makeFileIndex = (file: MDFileIndex) =>
  `- ${file.filename}\n${file.items.map(makeLink).map(indent(1))}`;
const indent = (n: number) => (s: string) =>
  `${new Array(n).fill("  ").join("")}${s}`;
