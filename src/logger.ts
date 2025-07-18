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
  private outputChannel: vscode.OutputChannel;
  private featureFlagManager?: FeatureFlagManager;
  private static instance?: Logger;

  private constructor() {
    this.outputChannel = vscode.window.createOutputChannel(
      "AppExplorer",
      "log",
    );
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
    this.featureFlagManager = featureFlagManager;

    // Show the output channel if debug mode is enabled
    if (featureFlagManager.isEnabled("debugMode")) {
      this.outputChannel.show(true); // true = preserve focus
      this.log(
        "logger",
        "debug",
        "Debug mode enabled - AppExplorer output channel shown",
      );
    }
  }

  /**
   * Create a prefixed logger instance
   */
  withPrefix(prefix: string): PrefixedLogger {
    return {
      debug: (message: string, ...args: any[]) =>
        this.log(prefix, "debug", message, ...args),
      info: (message: string, ...args: any[]) =>
        this.log(prefix, "info", message, ...args),
      warn: (message: string, ...args: any[]) =>
        this.log(prefix, "warn", message, ...args),
      error: (message: string, ...args: any[]) =>
        this.log(prefix, "error", message, ...args),
    };
  }

  /**
   * Internal logging method
   */
  private log(
    prefix: string,
    level: LogLevel,
    message: string,
    ...args: any[]
  ): void {
    // Check if we should show debug messages
    if (level === "debug" && !this.shouldShowDebug()) {
      return;
    }

    const timestamp = new Date().toISOString();
    const levelUpper = level.toUpperCase().padEnd(5); // Pad for alignment

    let formattedMessage = `[${timestamp}] [${prefix}] [${levelUpper}] ${message}`;

    // Add additional arguments if provided
    if (args.length > 0) {
      const argsString = args
        .map((arg) =>
          typeof arg === "object" ? JSON.stringify(arg, null, 2) : String(arg),
        )
        .join(" ");
      formattedMessage += ` ${argsString}`;
    }

    // Write to output channel
    this.outputChannel.appendLine(formattedMessage);

    // Also log to console for development
    if (this.shouldShowDebug()) {
      switch (level) {
        case "debug":
          console.debug(`[${prefix}]`, message, ...args);
          break;
        case "info":
          console.info(`[${prefix}]`, message, ...args);
          break;
        case "warn":
          console.warn(`[${prefix}]`, message, ...args);
          break;
        case "error":
          console.error(`[${prefix}]`, message, ...args);
          break;
      }
    }
  }

  /**
   * Check if debug messages should be shown
   */
  private shouldShowDebug(): boolean {
    return this.featureFlagManager?.isEnabled("debugMode") ?? false;
  }

  /**
   * Show the output channel
   */
  show(preserveFocus?: boolean): void {
    this.outputChannel.show(preserveFocus);
  }

  /**
   * Hide the output channel
   */
  hide(): void {
    this.outputChannel.hide();
  }

  /**
   * Clear the output channel
   */
  clear(): void {
    this.outputChannel.clear();
  }

  /**
   * Dispose of the output channel
   */
  dispose(): void {
    this.outputChannel.dispose();
  }
}

// Export singleton instance for easy importing
export const logger = Logger.getInstance();

// Export a convenience function for creating prefixed loggers
export function createLogger(prefix: string): PrefixedLogger {
  return logger.withPrefix(prefix);
}
