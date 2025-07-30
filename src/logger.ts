import { createWriteStream } from "fs";
import * as vscode from "vscode";
import { FeatureFlagManager } from "./feature-flag-manager";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface PrefixedLogger {
  debug(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
}

export class Logger {
  private logFile?: string;
  private logStream?: import("fs").WriteStream;
  private outputChannel: vscode.LogOutputChannel;
  private static instance?: Logger;

  private constructor() {
    this.outputChannel = vscode.window.createOutputChannel("AppExplorer", {
      log: true,
    });
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
  initialize(featureFlagManager: FeatureFlagManager): void {
    // Show the output channel if debug mode is enabled
    if (featureFlagManager.isEnabled("debugMode")) {
      this.outputChannel.show(true); // true = preserve focus
      this.outputChannel.debug(
        "[logger] Debug mode enabled - AppExplorer output channel shown",
      );
    }
  }

  /**
   * Create a prefixed logger instance
   */
  withPrefix = (prefix: string): PrefixedLogger => {
    return {
      debug: (message: string, ...args: any[]) => {
        const cleanArgs = args.map(cleanCardEvents);
        this.logStream?.write(
          `[${prefix}] [DEBUG] ${message} ${JSON.stringify(cleanArgs)}\n`,
        );
        this.outputChannel.debug(`[${prefix}] ${message}`, cleanArgs);
      },
      info: (message: string, ...args: any[]) => {
        const cleanArgs = args.map(cleanCardEvents);
        this.logStream?.write(
          `[${prefix}] [INFO ] ${message} ${JSON.stringify(cleanArgs)}\n`,
        );
        this.outputChannel.info(`[${prefix}] ${message}`, cleanArgs);
      },
      warn: (message: string, ...args: any[]) => {
        const cleanArgs = args.map(cleanCardEvents);
        this.logStream?.write(
          `[${prefix}] [WARN ] ${message} ${JSON.stringify(cleanArgs)}\n`,
        );
        this.outputChannel.warn(`[${prefix}] ${message}`, cleanArgs);
      },
      error: (message: string, ...args: any[]) => {
        const cleanArgs = args.map(cleanCardEvents);
        this.logStream?.write(
          `[${prefix}] [ERROR] ${message} ${JSON.stringify(cleanArgs)}\n`,
        );
        this.outputChannel.error(`[${prefix}] ${message}`, cleanArgs);
      },
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
        this.outputChannel.error(
          `[logger] Failed to write to log file: ${err.message}`,
        );
      });
      this.withPrefix("logs").info("Logging to " + this.logFile);
    } catch (err) {
      this.outputChannel.error(
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

// Export a convenience function for creating prefixed loggers
export function createLogger(prefix: string): PrefixedLogger {
  return logger.withPrefix(prefix);
}

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
        if (
          key === "cards" &&
          typeof value === "object" &&
          !Array.isArray(value) &&
          value
        ) {
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
