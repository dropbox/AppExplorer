import * as vscode from "vscode";
import { createLogger } from "./logger";

/**
 * Default production port for AppExplorer server
 * This MUST be 9042 for production Miro integration
 */
export const DEFAULT_PRODUCTION_PORT = 9042;

/**
 * Valid port range for server configuration
 */
export const PORT_RANGE = {
  MIN: 9042,
  MAX: 9999,
} as const;

/**
 * Port configuration utility for AppExplorer server
 *
 * This utility manages server port configuration with the following priorities:
 * 1. Runtime port override (process-scoped, for testing) - highest priority
 * 2. VSCode configuration setting (appExplorer.internal.serverPort) - for manual override
 * 3. Default production port (9042) - for normal operation
 *
 * ⚠️ IMPORTANT: Runtime port overrides are intended ONLY for E2E testing purposes.
 * Production Miro integration MUST always use port 9042.
 */
export class PortConfig {
  private static logger = createLogger("port-config");

  /**
   * Runtime port override for testing (process-scoped, not persisted)
   * This takes precedence over VSCode configuration settings
   */
  private static runtimePortOverride: number | null = null;

  /**
   * Get the configured server port
   *
   * Priority order:
   * 1. Environment variable APP_EXPLORER_PORT (for testing)
   * 2. Runtime port override (for testing - deprecated)
   * 3. VSCode configuration setting
   * 4. Production default (9042)
   *
   * @returns The configured port number, defaulting to 9042 for production
   */
  static getServerPort(): number {
    try {
      // Check for environment variable first (highest priority, for testing)
      const envPort = process.env.APP_EXPLORER_PORT;
      if (envPort) {
        const portNumber = parseInt(envPort, 10);
        if (!isNaN(portNumber)) {
          const validatedPort = this.validatePort(portNumber);

          this.logger.debug("Using environment variable port", {
            port: validatedPort,
            source: "APP_EXPLORER_PORT",
            isTestPort: validatedPort !== DEFAULT_PRODUCTION_PORT,
          });

          return validatedPort;
        } else {
          this.logger.warn("Invalid APP_EXPLORER_PORT environment variable", {
            value: envPort,
            fallback: "continuing with other sources",
          });
        }
      }

      // Check for runtime override (deprecated, kept for backward compatibility)
      if (this.runtimePortOverride !== null) {
        const validatedPort = this.validatePort(this.runtimePortOverride);

        this.logger.debug("Using runtime port override (deprecated)", {
          port: validatedPort,
          source: "runtime-override",
          isTestPort: validatedPort !== DEFAULT_PRODUCTION_PORT,
        });

        return validatedPort;
      }

      // Check VSCode configuration setting
      const config = vscode.workspace.getConfiguration("appExplorer.internal");
      const configuredPort = config.get<number>("serverPort");

      if (configuredPort !== undefined) {
        // Validate the configured port
        const validatedPort = this.validatePort(configuredPort);

        if (validatedPort !== DEFAULT_PRODUCTION_PORT) {
          this.logger.warn(
            "⚠️ Using non-production port from VSCode settings - this should ONLY be used for manual testing",
            {
              configuredPort: validatedPort,
              productionPort: DEFAULT_PRODUCTION_PORT,
              configSource: "appExplorer.internal.serverPort",
            },
          );
        } else {
          this.logger.debug("Using configured production port", {
            port: validatedPort,
          });
        }

        return validatedPort;
      }

      // No configuration found, use production default
      this.logger.debug(
        "No port configuration found, using production default",
        {
          port: DEFAULT_PRODUCTION_PORT,
        },
      );
      return DEFAULT_PRODUCTION_PORT;
    } catch (error) {
      this.logger.error(
        "Error reading port configuration, falling back to production default",
        {
          error: error instanceof Error ? error.message : String(error),
          fallbackPort: DEFAULT_PRODUCTION_PORT,
        },
      );
      return DEFAULT_PRODUCTION_PORT;
    }
  }

  /**
   * Validate a port number
   *
   * @param port The port number to validate
   * @returns The validated port number
   * @throws Error if the port is invalid
   */
  private static validatePort(port: number): number {
    if (!Number.isInteger(port)) {
      const error = `Port must be an integer, got: ${port}`;
      this.logger.error("Invalid port configuration", { port, error });
      throw new Error(error);
    }

    if (port < PORT_RANGE.MIN || port > PORT_RANGE.MAX) {
      const error = `Port must be between ${PORT_RANGE.MIN} and ${PORT_RANGE.MAX}, got: ${port}`;
      this.logger.error("Port out of valid range", {
        port,
        error,
        validRange: PORT_RANGE,
      });
      throw new Error(error);
    }

    return port;
  }

  /**
   * Set a runtime port override (process-scoped, not persisted)
   * This is the preferred method for testing as it doesn't modify VSCode settings
   *
   * @param port The port number to use, or null to clear the override
   */
  static setRuntimePortOverride(port: number | null): void {
    if (port !== null) {
      const validatedPort = this.validatePort(port);
      this.runtimePortOverride = validatedPort;

      this.logger.info("Runtime port override set", {
        port: validatedPort,
        isTestPort: validatedPort !== DEFAULT_PRODUCTION_PORT,
        scope: "process-only",
      });
    } else {
      this.runtimePortOverride = null;
      this.logger.info("Runtime port override cleared", {
        fallbackPort: DEFAULT_PRODUCTION_PORT,
      });
    }
  }

  /**
   * Get the current runtime port override
   *
   * @returns The runtime port override, or null if not set
   */
  static getRuntimePortOverride(): number | null {
    return this.runtimePortOverride;
  }

  /**
   * Check if the current configuration is using a non-production port
   *
   * @returns true if using a port other than the production default
   */
  static isUsingTestPort(): boolean {
    return this.getServerPort() !== DEFAULT_PRODUCTION_PORT;
  }

  /**
   * Check if currently using a runtime port override
   *
   * @returns true if a runtime port override is active
   */
  static hasRuntimePortOverride(): boolean {
    return this.runtimePortOverride !== null;
  }

  /**
   * Get port configuration diagnostics for debugging
   *
   * @returns Object containing port configuration details
   */
  static getDiagnostics(): {
    currentPort: number;
    isTestPort: boolean;
    productionPort: number;
    configSource: string;
    environmentPort: string | undefined;
    runtimeOverride: number | null;
    hasRuntimeOverride: boolean;
  } {
    const currentPort = this.getServerPort();
    const config = vscode.workspace.getConfiguration("appExplorer.internal");
    const configuredPort = config.get<number>("serverPort");
    const envPort = process.env.APP_EXPLORER_PORT;

    let configSource = "default";
    if (envPort && !isNaN(parseInt(envPort, 10))) {
      configSource = "APP_EXPLORER_PORT";
    } else if (this.runtimePortOverride !== null) {
      configSource = "runtime-override";
    } else if (configuredPort !== undefined) {
      configSource = "appExplorer.internal.serverPort";
    }

    return {
      currentPort,
      isTestPort: currentPort !== DEFAULT_PRODUCTION_PORT,
      productionPort: DEFAULT_PRODUCTION_PORT,
      configSource,
      environmentPort: envPort,
      runtimeOverride: this.runtimePortOverride,
      hasRuntimeOverride: this.runtimePortOverride !== null,
    };
  }

  /**
   * Set the server port configuration (primarily for testing)
   *
   * @param port The port number to set
   * @param global Whether to set globally or for workspace only
   */
  static async setServerPort(
    port: number,
    global: boolean = false,
  ): Promise<void> {
    const validatedPort = this.validatePort(port);

    this.logger.info("Setting server port configuration", {
      port: validatedPort,
      global,
      isTestPort: validatedPort !== DEFAULT_PRODUCTION_PORT,
    });

    const config = vscode.workspace.getConfiguration("appExplorer.internal");
    await config.update("serverPort", validatedPort, global);
  }

  /**
   * Reset server port to production default
   *
   * @param global Whether to reset globally or for workspace only
   */
  static async resetToProductionPort(global: boolean = false): Promise<void> {
    this.logger.info("Resetting server port to production default", {
      productionPort: DEFAULT_PRODUCTION_PORT,
      global,
    });

    const config = vscode.workspace.getConfiguration("appExplorer.internal");
    await config.update("serverPort", undefined, global);
  }
}
