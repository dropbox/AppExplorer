import type { TSESTree } from "@typescript-eslint/utils";
import { ESLintUtils } from "@typescript-eslint/utils";
import * as ts from "typescript";
import type { JSDocEntry } from "~/scanner/jsdoc-scanner";
import { tsUtils } from "./utils";

const createRule = ESLintUtils.RuleCreator(
  (name) => `https://example.com/rule/${name}`
);

/**
 * The start and end lineup with the whole comment node. It'll be up to the
 * rule's code to find exactly the right location.
 */
export type BoardPermalink = {
  location: string;
  permalink: string;
};

export function serializeSymbol(
  { checker, path, getLocation }: any,
  symbol: ts.Symbol,
  location: string
) {
  return {
    path,
    location,
    name: symbol.getName(),
    documentation: ts.displayPartsToString(
      symbol.getDocumentationComment(checker)
    ),
    type: checker.typeToString(
      checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration!)
    ),
  };
}

export const atAppExplorer = createRule({
  create(context) {
    const { boardPermalinks = [] } = context.options[0];
    const utils = tsUtils(context);

    function push(
      n: TSESTree.Node,
      docAncestorNode: ts.Node,
      docNode: ts.JSDoc | ts.JSDocTag | ts.JSDocComment,
      comment: string,
      boardLink?: JSDocEntry["boardLink"]
    ) {
      const data = {
        // comment: n.type + "\n" + comment,
        comment,
        location: utils.getLocation(docNode),
        parentNodeId: utils.nodeId(docAncestorNode),
        boardLink,
      };

      utils.report({
        node: n,
        key: "atAppExplorer",
        data,
        fix(fixer) {
          const link = boardPermalinks.find(
            ({ location }) => location === boardLink?.location
          );
          if (link != null && boardLink) {
            if (link.permalink !== boardLink.permalink) {
              const newComment = utils.sourceFile
                .getText()
                .slice(docNode.pos, docNode.end)
                .replace(
                  /@AppExplorer?[^\n]*/,
                  `@AppExplorer ${link.permalink}`
                );

              return fixer.replaceTextRange(
                [docNode.pos, docNode.end],
                newComment
              );
            }
          }
          return [];
        },
      });
    }

    return {
      "*": (n: TSESTree.Node) => {
        const utils = tsUtils(context);
        const node = utils.originalNode(n);
        if (!node) {
          return;
        }

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
            let appExplorer: JSDocEntry["boardLink"];
            if (
              !appExplorerTag.comment ||
              typeof appExplorerTag.comment === "string"
            ) {
              appExplorer = {
                comment: appExplorerTag.comment ?? "",
                location: utils.getLocation(appExplorerTag),
                parentNodeId: utils.nodeId(node),
                permalink: appExplorerTag.comment,
              };
            } else {
              throw new Error("IDK what to do with a NodeList here");
            }

            if (typeof doc.comment === "string") {
              push(
                n,
                node,
                doc,
                `@AppExplorer ${appExplorerTag.comment ?? ""}\n\n${
                  doc.comment
                }`,
                appExplorer
              );
            } else {
              doc.comment.forEach((comment) => {
                push(
                  n,
                  node,
                  doc,
                  `@AppExplorer ${appExplorerTag.comment ?? ""}\n${
                    doc.comment
                  }`,
                  appExplorer
                );
              });
            }
          }

          doc.tags?.forEach((tag) => {
            if (tag.tagName.text.match(/todo/i)) {
              if (typeof tag.comment === "string") {
                push(n, node, tag, "@TODO " + tag.comment);
              } else {
                tag.comment?.forEach((c) => {
                  push(n, node, c, "@TODO " + c.text);
                });
              }
            }
          });
        }
      },
    };
  },
  name: "at-app-explorer",
  meta: {
    docs: {
      description: "Gathers docblocks tagged with @AppExplorer",
      recommended: "warn",
    },
    messages: {
      atAppExplorer: "{{json}}",
    },
    type: "suggestion",
    fixable: "code",
    schema: [],
  },
  defaultOptions: [
    {
      boardPermalinks: [] as Array<BoardPermalink>,
    },
  ],
});
