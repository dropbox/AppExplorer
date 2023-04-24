import type {
  InitializeParams,
  InitializeResult,
  MessageConnection,
} from "vscode-languageserver-protocol";
import { launchLanguageServer } from "./lsp.server";
import { URI } from "vscode-uri";

let lsp: MessageConnection;

declare global {
  var __ts_lsp__: MessageConnection | undefined;
}

if (process.env.NODE_ENV !== "production") {
  if (global.__ts_lsp__) {
    lsp = global.__ts_lsp__;
  }
}

export const getTypescriptConnection = async () => {
  if (!lsp) {
    lsp = await makeTypeScriptConnection();
    if (process.env.NODE_ENV !== "production") {
      global.__ts_lsp__ = lsp;
    }
  }
  return lsp;
};

const makeTypeScriptConnection = async () => {
  // For the moment this is hard-coded to just look at this project.
  // Ideally this should be configurable to point to other projects.
  const rootUri = URI.file("../").toString();
  const connection = launchLanguageServer("typescript-language-server", [
    "--stdio",
  ]);

  connection.onUnhandledNotification((m) => {
    console.warn("Unhandled Notification", m);
  });
  connection.onUnhandledProgress((p) => {
    console.warn("Unhandled Progress", p);
  });

  connection.onNotification("textDocument/publishDiagnostics", (n) => {
    // I don't need these right now
  });

  const initializeParams: InitializeParams = {
    processId: process.pid,
    rootUri,
    clientInfo: {
      name: "AppExplorer",
    },
    capabilities: {
      textDocument: {
        implementation: {
          linkSupport: true,
        },
        synchronization: {
          dynamicRegistration: true,
        },
        documentSymbol: {
          hierarchicalDocumentSymbolSupport: true,
        },
        documentLink: {
          tooltipSupport: true,
          dynamicRegistration: true,
        },
        typeHierarchy: {
          dynamicRegistration: true,
        },
        definition: {
          linkSupport: true,
          dynamicRegistration: true,
        },
      },
      general: {},
      window: {
        showDocument: { support: false },
      },
      // definitionProvider: true,
    }, // Fill in the required capabilities
  };

  const initializeResult: InitializeResult = await connection.sendRequest(
    "initialize",
    initializeParams
  );

  console.log("INITIALIZE", initializeResult.capabilities);
  // connection.sendNotification("initialized");
  return connection;
};
