import * as vscode from "vscode";
import { HandlerContext } from "./extension";
import { FeatureFlagManager } from "./feature-flag-manager";
import { createLogger } from "./logger";
import { PortConfig } from "./port-config";
import { MiroServer } from "./server";
import { ServerDiscovery } from "./server-discovery";
import { delay, waitForValue } from "./test/suite/test-utils";

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
    // If no ServerDiscovery provided, create one with configured port
    this.serverDiscovery =
      serverDiscovery ||
      new ServerDiscovery({
        port: PortConfig.getServerPort(),
      });
    this.logger.debug("ServerLauncher initialized", {
      serverPort: this.serverDiscovery.getServerUrl(),
    });
  }

  /**
   * Determine server mode and launch server if needed
   */
  async initializeServer(
    handlerContext: HandlerContext,
  ): Promise<ServerLaunchResult> {
    this.logger.info("Initializing server", {
      enableServerDiscovery: this.featureFlagManager.isEnabled(
        "enableServerDiscovery",
      ),
      enableWorkspaceWebsockets: this.featureFlagManager.isEnabled(
        "enableWorkspaceWebsockets",
      ),
    });

    // Check if server discovery is enabled
    if (!this.featureFlagManager.isEnabled("enableServerDiscovery")) {
      this.logger.info(
        "Server discovery disabled, launching server in legacy mode",
      );
      return this.launchServer(handlerContext);
    }

    try {
      // Step 1: Check if server already exists
      this.logger.debug("Checking for existing server...");
      const serverExists = await this.serverDiscovery.checkServerHealth();
      this.logger.debug("Server health check result", { serverExists });

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
        this.logger.debug(
          "No existing server found, attempting to launch new server",
        );
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
    this.logger.debug("Attempting to launch server in this workspace");

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
      this.logger.info(
        "Server launch failed (likely race condition), attempting to connect as client",
        {
          error:
            launchError instanceof Error
              ? launchError.message
              : String(launchError),
          isPortInUse:
            String(launchError).includes("EADDRINUSE") ||
            String(launchError).includes("already in use"),
        },
      );

      // Wait a moment for the other server to fully start
      this.logger.debug("Waiting for other server to fully start...");
      await delay(1000);

      // Try to connect as client to the server that won the race
      this.logger.debug("Checking if other server is now available...");
      const serverExists = await waitForValue(async () => {
        return (await this.serverDiscovery.checkServerHealth())
          ? true
          : undefined;
      });
      this.logger.debug("Post-race server health check result", {
        serverExists,
      });

      const serverUrl = this.serverDiscovery.getServerUrl();
      this.logger.info(
        "Successfully connecting as client after race condition",
        { serverUrl },
      );
      return {
        mode: "client",
        serverUrl,
      };
    }
  }

  /**
   * Launch MiroServer in this workspace
   */
  private async launchServer(
    handlerContext: HandlerContext,
  ): Promise<ServerLaunchResult> {
    try {
      // Create and start server instance with proper error handling
      // Use the same port as ServerDiscovery for consistency
      const serverPort = PortConfig.getServerPort();
      const server = await MiroServer.create(
        handlerContext,
        this.featureFlagManager,
        serverPort,
      );

      return {
        mode: "server",
        server,
        serverUrl: this.serverDiscovery.getServerUrl(),
      };
    } catch (error) {
      // Port binding failed - another process is using the port
      this.logger.debug("Server launch failed", { error });
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
   * Dispose of resources
   */
  dispose(): void {
    this.serverDiscovery.dispose();
  }
}
