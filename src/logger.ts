import createDebug from "debug";
import { createWriteStream } from "fs";
import { formatWithOptions } from "util";
import * as vscode from "vscode";
const debug = createDebug("app-explorer:logger");

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface PrefixedLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export class Logger {
  private logFile?: string;
  private logStream?: import("fs").WriteStream;
  private outputChannel: vscode.OutputChannel;
  private static instance?: Logger;

  private constructor() {
    this.outputChannel = vscode.window.createOutputChannel(
      "AppExplorer",
      "log",
    );

    this.outputChannel.appendLine("Logger initialized");

    createDebug.enable("app-explorer:*");
    createDebug.log = (message, ...args: unknown[]) => {
      const formatedMessage = formatWithOptions(
        { colors: false, compact: true, maxArrayLength: 10, sorted: true },
        message,
        ...args.map(cleanCardEvents),
      );
      this.outputChannel.appendLine(formatedMessage);
    };
  }

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
      createDebug.enable(debug);
      this.outputChannel.show(true); // true = preserve focus
      this.outputChannel.appendLine(
        "[logger] Debug mode enabled - AppExplorer output channel shown",
      );
    }
  }

  /**
   * Create a prefixed logger instance
   */
  withPrefix = (prefix: string): PrefixedLogger => {
    const debug = createDebug(`app-explorer:${prefix}`);
    return {
      debug,
      info: debug,
      warn: debug,
      error: debug,
    };
  };

  getLogFile() {
    return this.logStream ? this.logFile : null;
  }

  storeLogs = (logUri: vscode.Uri) => {
    try {
      this.logFile = vscode.Uri.joinPath(logUri, `AppExplorer.log`).fsPath;
      this.logStream = createWriteStream(this.logFile);
      this.logStream.on("error", (err) => {
        this.outputChannel.appendLine(
          `[logger] Failed to write to log file: ${err.message}`,
        );
      });
      debug("Logging to " + this.logFile);
    } catch (err) {
      this.outputChannel.appendLine(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        `[logger] Failed to initialize log file: ${(err as any)?.message ?? err}`,
      );
    }
  };

  /**
   * Dispose of the output channel
   */
  dispose(): void {
    this.outputChannel.dispose();
    this.logStream?.close();
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
