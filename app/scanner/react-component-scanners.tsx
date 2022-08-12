import invariant from "tiny-invariant";
import * as ts from "typescript";
import { unique } from "~/utils/unique";
import type { DocEntry, NodeScanner, ScannerContext } from "./scanner.server";
import { visitRecursive } from "./scanner.server";

export type ComponentData = {
  name: string;
  location: string;
  exportedAs: null | string;
  referencedComponents: Array<string>;
  meta: DocEntry;
};

export type ReferencedComponent = {
  name: string;
  definitionLocation: string;
};

export type ReactComponentReport = {
  exports: Array<string>;
  components: Record<string, ComponentData | ReferencedComponent>;
  currentComponent?: string;
};

/**
 * Looks for an ImportKeyword, then looks up the stack to check for a
 * React.lazy, and then its VariableDeclaration
 *
 * @TODO: React.lazy is stringly checked. It will not find
 *        `import { lazy }  'react'; lazy(...)`
 *        `import troll 'react'; troll.lazy(...)`
 * @AppExplorer https://miro.com/app/board/uXjVOjdZo58=/?moveToWidget=3458764530348362332&cot=14
 * @param rootNode
 * @param context
 */
export const lazyScanner: NodeScanner<ReactComponentReport> = (
  rootNode,
  context
) => {
  visitRecursive(rootNode, context, (node, context, stack) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const arg = node.arguments[0];
      if (ts.isStringLiteralLike(arg)) {
        const path = arg.text;

        let foundLazyReact = false;
        for (const ancestor of [...stack].reverse()) {
          if (
            ts.isCallExpression(ancestor) &&
            ts.isPropertyAccessExpression(ancestor.expression) &&
            "React.lazy" ===
              context.printer.printNode(
                ts.EmitHint.Unspecified,
                ancestor.expression,
                context.sourceFile
              )
          ) {
            context.debug(
              "WARNING: This was detected with a string check against React.lazy"
            );
            foundLazyReact = true;
          }

          if (foundLazyReact && ts.isVariableDeclaration(ancestor)) {
            if (ts.isIdentifier(ancestor.name)) {
              const id = context.nodeId(ancestor.name);
              const definitionLocation = context.getLocation(ancestor);
              context.data.components[id] = {
                name: ancestor.name.text,
                definitionLocation,
              };
            } else {
              throw new Error(
                `Unhandled node type: ${ts.SyntaxKind[ancestor.name.kind]}`
              );
            }
          }
        }
      }
    }
  });
};

/**
 * Looks for a class extending React.Component or Component
 *
 * @TODO: React component is stringly typed
 * @AppExplorer https://miro.com/app/board/uXjVOjdZo58=/?moveToWidget=3458764530348362341&cot=14
 * @param node
 * @param context
 */
export const classComponentScanner: NodeScanner<ReactComponentReport> = (
  node,
  context
) => {
  if (ts.isClassDeclaration(node) && node.name) {
    if (extendsReactComponent(node, context)) {
      const { checker } = context;
      const nameSymbol = checker.getSymbolAtLocation(node.name);
      invariant(nameSymbol, "Missing name symbol");
      const exportedSymbol = checker.getExportSymbolOfSymbol(nameSymbol);
      const componentName = exportedSymbol.getName();

      const id = context.nodeId(node.name);

      const methodComponents = [];

      const location = context.getLocation(node.name);
      const classComponent: ComponentData = {
        name: componentName,
        exportedAs: context.isNodeExported(node) ? componentName : null,
        location,
        referencedComponents: [],
        meta: context.serializeSymbol(nameSymbol, location),
      };
      if (classComponent.exportedAs) {
        context.data.exports.push(id);
      }

      context.data.components[id] = classComponent;

      // Scan the functions to see which of them are secretly components
      for (const member of node.members) {
        if (
          ts.isMethodDeclaration(member) ||
          ts.isPropertyDeclaration(member)
        ) {
          const symbol = context.checker.getSymbolAtLocation(member.name);
          invariant(symbol);

          const methodName = symbol.getName();

          const methodRenderedComponets = findJSX(member, context);
          console.log("name:", methodName, methodRenderedComponets.length);
          if (methodRenderedComponets.length > 0) {
            if (methodName === "render") {
              classComponent.referencedComponents.push(
                ...methodRenderedComponets
              );
            } else {
              const functionId = `${id}.${methodName}()`;

              /**
               * If a method returns JSX, then I consider it its own component
               * on the graph.
               * @AppExplorer https://miro.com/app/board/uXjVOjdZo58=/?moveToWidget=3458764530348362349&cot=14
               */
              function captureMethodComponent(
                member: ts.MethodDeclaration | ts.PropertyDeclaration,
                symbol: ts.Symbol
              ) {
                methodComponents.push(functionId);
                classComponent.referencedComponents.push(functionId);
                const location = context.getLocation(member.name);
                context.data.components[functionId] = {
                  name: `${componentName}.${methodName}()`,
                  location,
                  referencedComponents: findJSX(member, context),
                  exportedAs: null,
                  meta: context.serializeSymbol(symbol, location),
                };
              }

              captureMethodComponent(member, symbol);
            }
          }
        } else {
          context.debug("Unhandled member type", member);
        }
      }

      classComponent.referencedComponents = unique(
        classComponent.referencedComponents
      );
    }
  }
};

/**
 * Just looks for functions then scans for JSX in them.
 *
 * @AppExplorer https://miro.com/app/board/uXjVOjdZo58=/?moveToWidget=3458764530348362354&cot=14
 * @param node
 * @param scannerContext
 */
export const functionComponentScanner: NodeScanner<ReactComponentReport> = (
  node,
  scannerContext
) => {
  if (ts.isFunctionDeclaration(node) && node.name) {
    const nameSymbol = scannerContext.checker.getSymbolAtLocation(node.name);

    if (nameSymbol) {
      const exportedSymbol =
        scannerContext.checker.getExportSymbolOfSymbol(nameSymbol);
      const componentName = exportedSymbol.getName();

      const jsx = findJSX(node, scannerContext);
      if (jsx.length > 0) {
        const id = scannerContext.nodeId(node.name);
        const location = scannerContext.getLocation(node.name);
        const tmp: ComponentData = {
          // "export default function HelloWorld"
          name: componentName,
          exportedAs: componentName,
          location,
          referencedComponents: jsx,
          meta: scannerContext.serializeSymbol(nameSymbol, location),
        };
        scannerContext.data.components[id] = tmp;

        if (scannerContext.isNodeExported(node)) {
          scannerContext.data.exports.push(id);
        }
      }
    } else {
      scannerContext.debug("No symbol name found for:", node);
    }
  }
};

const findJSX: NodeScanner<
  ReactComponentReport,
  | ts.FunctionDeclaration
  | ts.ClassDeclaration
  | ts.MethodDeclaration
  | ts.PropertyDeclaration,
  Array<string>
> = (functionNode, scannerContext) => {
  const jsx: Array<string> = [];

  visitRecursive(functionNode, scannerContext, (n) => {
    // Any JSX element
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const nameSymbol = scannerContext.checker.getSymbolAtLocation(n.tagName);
      if (nameSymbol) {
        const name = nameSymbol.getName();

        if (name[0].match(/[a-z]/)) {
          // Ignore host nodes (<div, <span, <button)
        } else {
          const id = scannerContext.nodeId(n.tagName);

          const localDeclaration = nameSymbol.declarations?.[0];
          let definitionLocation;
          if (localDeclaration) {
            definitionLocation = scannerContext.getLocation(localDeclaration);
          } else {
            console.log("FLAGS", nameSymbol.flags);
            definitionLocation = "?";
          }
          scannerContext.data.components[id] ??= {
            name,
            definitionLocation,
          };

          jsx.push(id);

          /**
           * This looks at the JSX attributes and if it finds a
           * `component={Something}`, then I assume it's some form of router
           * component no matter where it came from.
           *
           * @AppExplorer
           */
          function findRouteComponnets(c: ts.Node) {
            if (
              ts.isJsxAttribute(c) &&
              ts.isIdentifier(c.name) &&
              c.name.text === "component" &&
              c.initializer &&
              ts.isJsxExpression(c.initializer) &&
              c.initializer.expression
            ) {
              const s = scannerContext.checker.getSymbolAtLocation(
                c.initializer.expression
              );
              if (s && s.declarations) {
                const declaration = s.declarations[0];
                const definitionLocation =
                  scannerContext.getLocation(declaration);
                const id = scannerContext.nodeId(declaration);

                scannerContext.data.components[id] = {
                  name: s.getName(),
                  definitionLocation,
                };
                jsx.push(id);
              }
            } else {
              scannerContext.debug("attribute", c);
            }
          }

          n.attributes.forEachChild(findRouteComponnets);
        }
      }
    }
  });
  return unique(jsx);
};

/**
 * @TODO Change this function to resolve the destination and see if it's
 * actually the `Component` export of the 'react' package.
 * @TODO Then make a way to pass in a list of things that are "components". I'm
 * not familiar withh how other frameworks manage this exactly
 * @AppExplorer
 * @param node
 * @param scannerContext
 * @returns
 */
function extendsReactComponent(
  node: ts.ClassDeclaration,
  scannerContext: ScannerContext<{}>
): boolean {
  return (
    true ===
    node.heritageClauses?.some((heritige) => {
      if (heritige.token === ts.SyntaxKind.ExtendsKeyword) {
        return heritige.types.some(({ expression }) => {
          const symbol = scannerContext.checker.getSymbolAtLocation(expression);
          if (symbol) {
            const baseClass = scannerContext.printer.printNode(
              ts.EmitHint.Unspecified,
              expression,
              scannerContext.sourceFile
            );

            if (["React.Component", "Component"].includes(baseClass)) {
              scannerContext.debug(
                "WARNING: This was checked by the string name, not resolving the import",
                heritige.parent
              );
              return true;
            }
          }
          return false;
        });
      }
      return false;
    })
  );
}
