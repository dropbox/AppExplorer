import invariant from "tiny-invariant";
import ts from "typescript";
import * as fs from "~/utils/fs.server";
import type { NodeScanner } from "./scanner.server";
import { REPO_ROOT, visitRecursive } from "./scanner.server";

export type JSDocEntry = {
  location: string;
  comment: string;
  parentNodeId: string;
  key?: number;
  boardLink?: JSDocEntry & {
    permalink?: string;
  };
};

export type JSDocReport = {
  jsDoc: Array<JSDocEntry>;
};

/**
 *
 * @TODO Use the AST and a transform to a safer update
 */
export async function writeBoardLink(
  boardLink: NonNullable<JSDocEntry["boardLink"]>
) {
  const [file, lines] = boardLink.location.split("#L");
  const fullPath = fs.pathJoin(REPO_ROOT, file);
  const fileStat = await fs.stat(fullPath);
  invariant(fileStat.isFile(), () => `expected to find a file at ${fullPath}`);

  const source = await fs.readFile(fullPath, {
    encoding: "utf-8",
  });
  let [strLine] = lines.split("-");
  invariant(
    typeof strLine === "string",
    () => `First line not found in ${boardLink.location}`
  );
  const firstLine = parseInt(strLine, 10);
  invariant(
    !isNaN(firstLine),
    () => `First line not found in ${boardLink.location}`
  );

  let position = 0;
  let line = 0;
  let EOL = 0;
  let lineText = "";
  do {
    position = EOL;
    EOL = source.indexOf("\n", position + 1);
    lineText = source.slice(position, EOL);
    line++;
    // console.log('line', line, position, EOL, lineText)
  } while (line < firstLine);

  const before = source.slice(0, position);
  const after = source.slice(EOL);

  const replacement = lineText.replace(
    /@AppExplorer.*/,
    `@AppExplorer ${boardLink.permalink}`
  );
  const newSource = before + replacement + after;

  await fs.writeFile(fullPath, newSource);
}

/**
 * visitNode talks the tree recursively, but does NOT stop at all nodes.  This
 * function needs to use node.getChildren() to find a JSDoc node.  If it's
 * tagged @AppExplorer or @TODO, then it'll get added to the report.
 *
 *
 * The chart code turns @TODO into cards and @AppExplorer into rectangles.
 *
 * @AppExplorer https://miro.com/app/board/uXjVOjdZo58=/?moveToWidget=3458764530345975648&cot=14
 */
export const jsdocScanner: NodeScanner<JSDocReport> = (
  rootNode,
  scannerContext
) => {
  visitRecursive(rootNode, scannerContext, (node, context, stack) => {
    const push = (n: ts.Node, comment: string, atAppExplorer?: JSDocEntry) => {
      scannerContext.data.jsDoc.push({
        comment,
        location: context.getLocation(n),
        parentNodeId: context.nodeId(node),
        boardLink: atAppExplorer,
      });
    };
    const maybeDoc = node.getChildren().find((n) => {
      return n.kind === ts.SyntaxKind.JSDoc;
    });
    if (maybeDoc) {
      const doc = maybeDoc as ts.JSDoc;

      const appExplorerTag = doc.tags?.find(
        (t) =>
          ts.isJSDocUnknownTag(t) && t.tagName.escapedText === "AppExplorer"
      );
      if (appExplorerTag && doc.comment != null) {
        let appExplorer: JSDocEntry;
        if (
          !appExplorerTag.comment ||
          typeof appExplorerTag.comment === "string"
        ) {
          appExplorer = {
            comment: appExplorerTag.comment ?? "",
            location: context.getLocation(appExplorerTag),
            parentNodeId: context.nodeId(node),
          };
        } else {
          throw new Error("IDK what to do with a NodeList here");
        }
        if (typeof doc.comment === "string") {
          push(doc, "@AppExplorer " + doc.comment, appExplorer);
        } else {
          doc.comment.forEach((comment) => {
            push(doc, "@AppExplorer " + comment.text, appExplorer);
          });
        }
      }

      doc.tags?.forEach((tag) => {
        if (tag.tagName.text.match(/todo/i)) {
          if (typeof tag.comment === "string") {
            push(tag, "@TODO " + tag.comment);
          } else {
            tag.comment?.forEach((c) => {
              push(c, "@TODO " + c.text);
            });
          }
        }
      });
    }
  });

  const docID = (entry: JSDocEntry) => `${entry}#${entry.key}`;
  scannerContext.data.jsDoc.forEach((entry, index, arr) => {
    for (let i = 0; i < index; i++) {
      const element = arr[i];
      if (docID(element) === docID(entry)) {
        entry.key = (entry.key ?? 0) + 1;
      }
    }
  });
};
