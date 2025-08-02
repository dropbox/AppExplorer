import createDebug from "debug";
import invariant from "tiny-invariant";
import { formatWithOptions } from "util";
import * as vscode from "vscode";
import { LogPipe } from "./log-pipe";

createDebug.inspectOpts ??= {};
createDebug.inspectOpts.hideDate = true;
const debug = createDebug("app-explorer:logger");

createDebug.enable("app-explorer:*");

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface PrefixedLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export class Logger {
  private outputChannel: vscode.OutputChannel;
  private static instance?: Logger;
  logWrite: ((line: string) => Promise<void>) | undefined;
  logUri: vscode.Uri | undefined;
  logPipe: LogPipe | undefined;

  private constructor() {
    this.outputChannel = vscode.window.createOutputChannel(
      "AppExplorer",
      "log",
    );

    this.outputChannel.appendLine("Logger initialized");

    createDebug.log = this.log;
  }

  log = (message: unknown, ...args: unknown[]) => {
    const formatedMessage = formatWithOptions(
      { colors: false, compact: true, maxArrayLength: 10, sorted: true },
      message,
      ...args.map(cleanCardEvents),
    );
    this.outputChannel.appendLine(formatedMessage);
    this.logWrite?.(formatedMessage + "\n");
  };

  /**
   * Get the singleton logger instance
   */
  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  /**
   * Initialize the logger with feature flag manager
   */
  initialize(): void {
    // Show the output channel if debug mode is enabled
    const config = vscode.workspace.getConfiguration("appExplorer");
    const debug = config.get<string>("debug");

    if (debug) {
      // createDebug.enable(debug);
      this.outputChannel.show(true); // true = preserve focus
      this.outputChannel.appendLine(
        "[logger] Debug mode enabled - AppExplorer output channel shown",
      );
    }
  }

  getLogFile(DEBUG: string = "app-explorer:*"): [string, string] | undefined {
    createDebug.enable(DEBUG);
    return this.logUri
      ? ([this.logUri.fsPath, `AppExplorer.pipe`] as const)
      : undefined;
  }

  storeLogs = async (logUri: vscode.Uri): Promise<LogPipe | undefined> => {
    try {
      this.logUri = logUri;
      const [logPath, logFile] = this.getLogFile() ?? [];
      invariant(logPath, "Log path must be set");
      invariant(logFile, "Log file must be set");

      this.logPipe = new LogPipe(logPath, logFile);
      this.logWrite = await this.logPipe.getWriter();
    } catch (err) {
      this.outputChannel.appendLine(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        `[logger] Failed to initialize log file: ${(err as any)?.message ?? err}`,
      );
    }
    return undefined;
  };

  /**
   * Dispose of the output channel
   */
  dispose(): void {
    this.outputChannel.dispose();
    this.logPipe?.dispose();
  }
}

// Export singleton instance for easy importing
export const logger = Logger.getInstance();

const cleanMap = new WeakMap<object, boolean>();
function cleanCardEvents<T extends unknown>(eventFragment: T): T {
  if (Array.isArray(eventFragment)) {
    return eventFragment.map(cleanCardEvents) as T;
  }
  if (typeof eventFragment === "object" && eventFragment !== null) {
    if (cleanMap.get(eventFragment)) {
      return eventFragment;
    }
    cleanMap.set(eventFragment, true);
    const cleaned = Object.fromEntries(
      Object.entries(eventFragment).map(([key, value]) => {
        if (typeof value === "function") {
          return [key, value.toString()];
        }
        if (value && key === "cards") {
          if (Array.isArray(value)) {
            return [key, `(${value.length} cards)`];
          }

          return [key, `(${Object.keys(value).length} cards)`];
        }

        return [key, cleanCardEvents(value)];
      }),
    );
    cleanMap.delete(eventFragment);
    return cleaned as T;
  }

  return eventFragment;
}
