import * as fs from "fs/promises";
import { join } from "path";
import invariant from "tiny-invariant";
import * as ts from "typescript";
import { pathJoin } from "~/utils/fs.server";
import { getCommitHash, getRemoteURL } from "./git.server";

// NOTE: __dirname is not really scanner.server.tsx, but this works good enough for now
export const REPO_ROOT = process.env.REPO_ROOT ?? join(__dirname, "../example");

export async function statPath(path: string) {
  const fullPath = pathJoin(REPO_ROOT, path);
  return fs.stat(fullPath);
}

export type NodeScanner<
  TData extends {},
  T extends ts.Node = ts.Node,
  R = void
> = (node: T, scannerContext: ScannerContext<TData>) => R;

export type RecursiveNodeScanner<
  TData extends {},
  T extends ts.Node = ts.Node,
  R = void
> = (
  node: T,
  scannerContext: ScannerContext<TData>,
  stack: Array<ts.Node>
) => R;

export type ScannerContext<TData extends {}> = {
  data: TData;
  path: string;
  hash: string;
  remote: string;

  checker: ts.TypeChecker;
  printer: ts.Printer;
  sourceFile: ts.SourceFile;

  debug: (message: string, node?: ts.Node) => void;
  isNodeExported: (node: ts.Node) => boolean;
  serializeSymbol: (symbol: ts.Symbol, location: string) => DocEntry;
  getLocation: (node: ts.Node) => string;
  nodeId: (node: ts.Node) => string;
};

function serializeSymbol(
  { checker, path, getLocation }: ScannerContext<any>,
  symbol: ts.Symbol,
  location: string
): DocEntry {
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

export interface DocEntry {
  path: string;
  location: string;
  name?: string;
  fileName?: string;
  documentation?: string;
  type?: string;
  constructors?: DocEntry[];
  parameters?: DocEntry[];
  returnType?: string;
}

export type DebugLog = {
  debug?: string[];
};

export type RepoData = {
  hash: string;
  remote: string;
};

export async function scanFile<TData extends DebugLog>(
  path: string,
  scanners: Array<NodeScanner<TData>>,
  mutatableData: TData
): Promise<(TData & RepoData) | null> {
  const fullPath = join(REPO_ROOT, path);
  const stat = await statPath(path);

  if (!stat.isFile()) {
    return null;
  }

  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES5,
    module: ts.ModuleKind.CommonJS,
  };

  const otherFiles: string[] = [];
  // Build a program using the set of root file names in fileNames
  let program = ts.createProgram([fullPath, ...otherFiles], options);

  // Get the checker, we will use it to find more about classes
  let checker = program.getTypeChecker();

  const hash = await getCommitHash(fullPath);
  const remote = await getRemoteURL(fullPath);

  // Visit every sourceFile in the program
  for (const sourceFile of program.getSourceFiles()) {
    if (!sourceFile.isDeclarationFile) {
      const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });

      const scannerContext: ScannerContext<TData> = {
        data: mutatableData,
        hash,
        remote,
        path,
        checker,
        sourceFile,
        serializeSymbol: (n, location) =>
          serializeSymbol(scannerContext, n, location),
        isNodeExported,
        debug(message: string, node?: ts.Node) {
          mutatableData.debug ??= [];

          mutatableData.debug.push(
            message +
              (node
                ? `: (${ts.SyntaxKind[node.kind]}) ` +
                  printer.printNode(
                    ts.EmitHint.Unspecified,
                    node,
                    scannerContext.sourceFile
                  )
                : "")
          );
        },
        getLocation(n) {
          const { line: start } = sourceFile.getLineAndCharacterOfPosition(
            n.pos
          );
          const { line: end } = sourceFile.getLineAndCharacterOfPosition(n.end);
          if (start != end) {
            return `${path}#L${start + 1}-${end + 1}`;
          } else {
            return `${path}#L${start + 1}`;
          }
        },
        nodeId: (n: ts.Node) => {
          const symbol = checker.getSymbolAtLocation(n);
          if (symbol) {
            return `${path}:${symbol.getName()}`;
          }
          if (ts.isFunctionDeclaration(n) && n.name) {
            return scannerContext.nodeId(n.name);
          }
          if (n.kind === ts.SyntaxKind.FirstStatement) {
            console.log({ ...n, parent: null });

            if ("declarationList" in n) {
              // @ts-ignore
              return scannerContext.nodeId(n.declarationList);
            }
          }
          if (ts.isVariableDeclarationList(n)) {
            return scannerContext.nodeId(n.declarations[0]);
          }
          if (ts.isVariableDeclaration(n)) {
            return scannerContext.nodeId(n.name);
          }

          invariant(
            symbol,
            () =>
              `Symbol not found for ${
                ts.SyntaxKind[n.kind]
              }\n${printer.printNode(
                ts.EmitHint.Unspecified,
                n,
                scannerContext.sourceFile
              )}`
          );
          return scannerContext.getLocation(n);
        },

        printer,
      };

      // Walk the tree to search for classes
      ts.forEachChild(sourceFile, (n) => visit(n, scannerContext));
    }
  }

  return {
    ...mutatableData,
    hash,
    remote,
  };

  function visit(node: ts.Node, scannerContext: ScannerContext<TData>) {
    scanners.forEach((s) => s(node, scannerContext));
  }

  /** True if this is visible outside this file, false otherwise */
  function isNodeExported(node: ts.Node): boolean {
    return (
      (ts.getCombinedModifierFlags(node as ts.Declaration) &
        ts.ModifierFlags.Export) !==
        0 ||
      (!!node.parent && node.parent.kind === ts.SyntaxKind.SourceFile)
    );
  }
}

export function visitRecursive<TData, R extends any>(
  node: ts.Node,
  scannerContext: ScannerContext<TData>,
  scan: RecursiveNodeScanner<TData, ts.Node, R>
): R | undefined {
  return visitRecursive(node);

  function visitRecursive(node: ts.Node, stack: ts.Node[] = []): R | undefined {
    const indent = new Array(stack.length).join("  ");
    const debug = (message: string, node?: ts.Node) =>
      scannerContext.debug(indent + message, node);

    const anything = scan(node, { ...scannerContext, debug }, stack);
    if (anything) {
      return anything;
    }

    // If the callback returns a truthy value, it stops and returns that value
    return ts.forEachChild(node, (n) =>
      visitRecursive(n, stack.concat([node]))
    );
  }
}
