import type { TSESTree } from "@typescript-eslint/utils";
import { ESLintUtils } from "@typescript-eslint/utils";
import type {
  ReportFixFunction,
  RuleContext,
} from "@typescript-eslint/utils/dist/ts-eslint";
import invariant from "tiny-invariant";
import * as ts from "typescript";
import type { JSDocEntry } from "~/scanner/jsdoc-scanner";
import { serializeSymbol } from "./at-app-explorer";

type TypeMap = {
  atAppExplorer: JSDocEntry;
};

export function serialize<Key extends keyof TypeMap>(
  _key: Key,
  data: TypeMap[Key]
) {
  return JSON.stringify(data);
}

export function deserialize<Key extends keyof TypeMap>(
  _key: Key,
  str: string
): TypeMap[Key] {
  return JSON.parse(str);
}

export function tsUtils(context: RuleContext<any, any>) {
  const path = context.getFilename();
  const parserServices = ESLintUtils.getParserServices(context);
  const checker = parserServices.program.getTypeChecker();
  const sourceFile = parserServices.program.getSourceFile(path);
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  invariant(sourceFile, () => `Expected a sourceFile from ${path}`);

  const originalNode = (node: TSESTree.Node) =>
    parserServices.esTreeNodeToTSNodeMap.get(node);

  const serializedReports: Array<string> = [];

  type ReportArgs<Key extends keyof TypeMap> = {
    node: TSESTree.Node;
    key: Key;
    data: TypeMap[Key];
    fix?: ReportFixFunction;
  };
  function report<Key extends keyof TypeMap>({
    node,
    key,
    data,
    fix,
  }: ReportArgs<Key>) {
    const json = serialize(key, data);
    if (serializedReports.includes(json)) {
      return;
    }
    serializedReports.push(json);
    context.report({
      node,
      data: { json },
      messageId: key,
      fix,
    });
  }

  const scannerContext = {
    checker,
    sourceFile,
    originalNode,
    report,
    serializeSymbol: (symbol: ts.Symbol, location: string) =>
      serializeSymbol(scannerContext, symbol, location),
    getLocation(node: ts.Node) {
      let start: number;
      let end: number;
      const startPosition = sourceFile.getLineAndCharacterOfPosition(node.pos);
      const endPosition = sourceFile.getLineAndCharacterOfPosition(node.end);
      start = startPosition.line;
      end = endPosition.line;
      if (start != end) {
        return `${path}#L${start + 1}-${end + 1}`;
      } else {
        return `${path}#L${start + 1}`;
      }
    },
    nodeId: (node: ts.Node): string => {
      invariant(node, () => {
        console.error("MISSING", node);
        return "Missing node";
      });

      const symbol = checker.getSymbolAtLocation(node);
      if (symbol) {
        return `${path}:${symbol.getName()}`;
      }
      if (ts.isFunctionDeclaration(node) && node.name) {
        return scannerContext.nodeId(node.name);
      }
      if (node.kind === ts.SyntaxKind.FirstStatement) {
        if ("declarationList" in node) {
          // @ts-ignore
          return scannerContext.nodeId(node.declarationList);
        }
      }
      if (ts.isVariableDeclarationList(node)) {
        return scannerContext.nodeId(node.declarations[0]);
      }
      if (ts.isVariableDeclaration(node)) {
        return scannerContext.nodeId(node.name);
      }
      if (ts.isClassDeclaration(node) && node.name) {
        return scannerContext.nodeId(node.name);
      }

      invariant(
        symbol,
        () =>
          `Symbol not found for ${
            ts.SyntaxKind[node.kind]
          }\n${printer.printNode(
            ts.EmitHint.Unspecified,
            node,
            scannerContext.sourceFile
          )}`
      );
      return scannerContext.getLocation(node);
    },

    printer,
  };
  return scannerContext;
}
