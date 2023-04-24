import type {
  MessageConnection,
  DocumentSymbolParams,
  DidOpenTextDocumentParams,
  DefinitionParams,
  Position,
  TextDocumentIdentifier,
  Definition,
  LocationLink,
  DocumentSymbol,
} from "vscode-languageserver-protocol";
import { DocumentSymbolRequest } from "vscode-languageserver-protocol";
import { URI } from "vscode-uri";
import * as fs from "fs/promises";
import { spawn } from "node:child_process";
import * as rpc from "vscode-jsonrpc";
import identity from "lodash.identity";
import path from "path";
import type { Params } from "@remix-run/react";
export { getTypescriptConnection } from "./ts";

type Project = {
  readonly root: string;
};
export const LSPProjects = {
  AppExplorer: {
    root: path.join(__dirname, "../"),
  },
} as const;

export function launchLanguageServer(
  command: string,
  args: string[]
): MessageConnection {
  console.log({ command, args });
  const childProcess = spawn(command, args, {
    stdio: "pipe",
  });

  // Use stdin and stdout for communication:
  let connection = rpc.createMessageConnection(
    // @ts-ignore This does exist
    new rpc.StreamMessageReader(childProcess.stdout),
    // @ts-ignore This does exist
    new rpc.StreamMessageWriter(childProcess.stdin)
  );

  connection.listen();

  return connection;
}

export async function openTextDocument(
  connection: MessageConnection,
  filePath: string
) {
  const uri = URI.file(filePath).toString();
  const text = await fs.readFile(filePath, "utf-8");

  await connection.sendNotification(
    "textDocument/didOpen",
    identity<DidOpenTextDocumentParams>({
      textDocument: {
        uri,
        languageId: "typescript", // Use 'php' for PHP files
        version: 1,
        text,
      },
    })
  );

  return { uri, text };
}

export function requestDocumentSymbols(
  connection: MessageConnection,
  uri: string
) {
  return connection.sendRequest<DocumentSymbol[]>(
    DocumentSymbolRequest.method,
    identity<DocumentSymbolParams>({
      textDocument: {
        uri,
      },
    })
  );
}

export function requestDefinition(
  connection: MessageConnection,
  document: TextDocumentIdentifier,
  position: Position
) {
  const params: DefinitionParams = { textDocument: document, position };
  return connection.sendRequest<Definition | LocationLink[] | null>(
    "textDocument/definition",
    params
  );
}

export function goToDefinition(
  connection: MessageConnection,
  document: TextDocumentIdentifier,
  position: Position
) {
  const params: DefinitionParams = {
    textDocument: document,
    position,
  };
  return connection.sendRequest<Definition | LocationLink[] | null>(
    "textDocument/definition",
    params
  );
}

export function requireProject(params: Params): readonly [string, Project] {
  const projectName = params.project as keyof typeof LSPProjects;
  const project = LSPProjects[projectName];
  if (!project) {
    throw new Response("Project not found", { status: 404 });
  }
  return [projectName, project] as const;
}

export function readProjectFile(
  project: { root: string },
  requestedPath: string
) {
  if (!requestedPath) {
    throw new Response("Path is required", { status: 400 });
  }
  const fullPath = path.join(project.root, requestedPath);
  if (!fullPath.startsWith(project.root)) {
    throw new Response("Path is invalid", { status: 400 });
  }

  const fileContent = fs.readFile(fullPath, "utf-8");
  return { fileContent, fullPath };
}

export function resolvePath(project: Project, requestedPath: string) {
  const fullPath = path.join(project.root, requestedPath);
  if (!fullPath.startsWith(project.root)) {
    throw new Response("Path is invalid", { status: 400 });
  }
  return fullPath;
}
