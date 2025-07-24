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
        this.logStream?.write(
          `[${prefix}] [DEBUG] ${message} ${JSON.stringify(args)}\n`,
        );
        this.outputChannel.debug(`[${prefix}] ${message}`, ...args);
      },
      info: (message: string, ...args: any[]) => {
        this.logStream?.write(
          `[${prefix}] [INFO ] ${message} ${JSON.stringify(args)}\n`,
        );
        this.outputChannel.info(`[${prefix}] ${message}`, ...args);
      },
      warn: (message: string, ...args: any[]) => {
        this.logStream?.write(
          `[${prefix}] [WARN ] ${message} ${JSON.stringify(args)}\n`,
        );
        this.outputChannel.warn(`[${prefix}] ${message}`, ...args);
      },
      error: (message: string, ...args: any[]) => {
        this.logStream?.write(
          `[${prefix}] [ERROR] ${message} ${JSON.stringify(args)}\n`,
        );
        this.outputChannel.error(`[${prefix}] ${message}`, ...args);
      },
    };
  };

  getLogFile() {
    return this.logFile;
  }

  storeLogs = (logUri: vscode.Uri) => {
    this.logFile = vscode.Uri.joinPath(logUri, `app-explorer.log`).fsPath;
    this.logStream = createWriteStream(this.logFile);
    this.withPrefix("logs").info("Logging to " + this.logFile);
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
