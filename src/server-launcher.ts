import * as vscode from "vscode";
import { HandlerContext } from "./extension";
import { FeatureFlagManager } from "./feature-flag-manager";
import { createLogger } from "./logger";
import { MiroServer } from "./server";
import { ServerDiscovery } from "./server-discovery";

export type ServerMode = "server" | "client" | "disabled";

export interface ServerLaunchResult {
  mode: ServerMode;
  server?: MiroServer;
  serverUrl?: string;
  error?: string;
}

export class ServerLauncher {
  private serverDiscovery: ServerDiscovery;
  private featureFlagManager: FeatureFlagManager;
  private logger = createLogger("server-launcher");

  constructor(
    _context: vscode.ExtensionContext,
    featureFlagManager: FeatureFlagManager,
    serverDiscovery?: ServerDiscovery,
  ) {
    this.featureFlagManager = featureFlagManager;
    this.serverDiscovery = serverDiscovery || new ServerDiscovery();
    this.logger.debug("ServerLauncher initialized");
  }

  /**
   * Determine server mode and launch server if needed
   */
  async initializeServer(
    handlerContext: HandlerContext,
  ): Promise<ServerLaunchResult> {
    // Check if server discovery is enabled
    if (!this.featureFlagManager.isEnabled("enableServerDiscovery")) {
      // Legacy mode - always launch server in this workspace
      return this.launchServer(handlerContext);
    }

    try {
      // Step 1: Check if server already exists
      const serverExists = await this.serverDiscovery.checkServerHealth();

      if (serverExists) {
        // Step 2a: Server exists, connect as client
        const serverUrl = this.serverDiscovery.getServerUrl();

        this.logger.info("Existing server detected, connecting as client", {
          serverUrl,
        });

        return {
          mode: "client",
          serverUrl,
        };
      } else {
        // Step 2b: No server exists, try to launch one
        return this.attemptServerLaunch(handlerContext);
      }
    } catch (error) {
      this.logger.error(
        "Error during server initialization, falling back to legacy mode",
        { error },
      );

      // Fallback to legacy mode on error
      return this.launchServer(handlerContext);
    }
  }

  /**
   * Attempt to launch server with race condition handling
   */
  private async attemptServerLaunch(
    handlerContext: HandlerContext,
  ): Promise<ServerLaunchResult> {
    try {
      // Try to launch server - if another workspace wins the race, this will fail
      const server = await this.launchServer(handlerContext);

      if (server.server) {
        this.logger.info("Successfully launched server in this workspace");
        return server;
      } else {
        throw new Error("Failed to launch server");
      }
    } catch (launchError) {
      // Server launch failed - likely another workspace won the race
      this.logger.debug(
        "Server launch failed (likely race condition), attempting to connect as client",
        { launchError },
      );

      // Wait a moment for the other server to fully start
      await this.delay(1000);

      // Try to connect as client to the server that won the race
      const serverExists = await this.serverDiscovery.checkServerHealth();

      if (serverExists) {
        const serverUrl = this.serverDiscovery.getServerUrl();
        return {
          mode: "client",
          serverUrl,
        };
      } else {
        // Still no server - something went wrong
        return {
          mode: "disabled",
          error: `Failed to launch server and no existing server found: ${launchError}`,
        };
      }
    }
  }

  /**
   * Launch MiroServer in this workspace
   */
  private async launchServer(
    handlerContext: HandlerContext,
  ): Promise<ServerLaunchResult> {
    try {
      const server = new MiroServer(handlerContext);

      // The MiroServer constructor will attempt to bind to port 9042
      // If it fails due to port already in use, it will throw an error

      return {
        mode: "server",
        server,
        serverUrl: this.serverDiscovery.getServerUrl(),
      };
    } catch (error) {
      // Port binding failed - another process is using the port
      throw error;
    }
  }

  /**
   * Handle server failover when current server goes down
   */
  async handleServerFailover(
    handlerContext: HandlerContext,
  ): Promise<ServerLaunchResult> {
    this.logger.info(
      "Handling server failover, attempting to launch new server",
    );

    // Try to launch a new server to replace the failed one
    return this.attemptServerLaunch(handlerContext);
  }

  /**
   * Check if we should attempt server failover
   */
  shouldAttemptFailover(): boolean {
    return (
      this.featureFlagManager.isEnabled("enableServerDiscovery") &&
      this.featureFlagManager.isEnabled("enableServerFailover")
    );
  }

  /**
   * Get current server discovery instance
   */
  getServerDiscovery(): ServerDiscovery {
    return this.serverDiscovery;
  }

  /**
   * Utility method for delays
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.serverDiscovery.dispose();
  }
}
