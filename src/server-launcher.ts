import createDebug from "debug";
import { FeatureFlagManager } from "./feature-flag-manager";
import { PortConfig } from "./port-config";
import { MiroServer } from "./server";
import { ServerDiscovery } from "./server-discovery";
import { delay, waitForValue } from "./test/suite/test-utils";

const debug = createDebug("app-explorer:server-launcher");
export type ServerMode = "server" | "client";

export interface ServerLaunchResult {
  mode: ServerMode;
  server?: MiroServer;
  serverUrl?: string;
  error?: string;
}

export class ServerLauncher {
  private serverDiscovery: ServerDiscovery;
  private featureFlagManager: FeatureFlagManager;
  subscriptions: { dispose: () => void }[] = [];

  constructor(
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
    debug("ServerLauncher initialized", {
      serverPort: this.serverDiscovery.getServerUrl(),
    });
  }

  /**
   * Determine server mode and launch server if needed
   */
  async initializeServer(): Promise<ServerLaunchResult> {
    debug("Initializing server");

    try {
      // Step 1: Check if server already exists
      debug("Checking for existing server...");
      const serverExists = await this.serverDiscovery.checkServerHealth();
      debug("Server health check result", { serverExists });

      if (serverExists) {
        // Step 2a: Server exists, connect as client
        const serverUrl = this.serverDiscovery.getServerUrl();

        debug("Existing server detected, connecting as client", {
          serverUrl,
        });

        return {
          mode: "client",
          serverUrl,
        };
      } else {
        // Step 2b: No server exists, try to launch one
        debug("No existing server found, attempting to launch new server");
        return this.attemptServerLaunch();
      }
    } catch (error) {
      debug("Error during server initialization, falling back to legacy mode", {
        error,
      });

      // Fallback to legacy mode on error
      return this.launchServer();
    }
  }

  /**
   * Attempt to launch server with race condition handling
   */
  private async attemptServerLaunch(): Promise<ServerLaunchResult> {
    debug("Attempting to launch server in this workspace");

    try {
      // Try to launch server - if another workspace wins the race, this will fail
      const server = await this.launchServer();

      if (server.server) {
        debug("Successfully launched server in this workspace");
        return server;
      } else {
        throw new Error("Failed to launch server");
      }
    } catch (launchError) {
      // Server launch failed - likely another workspace won the race
      debug(
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
      debug("Waiting for other server to fully start...");
      await delay(1000);

      // Try to connect as client to the server that won the race
      debug("Checking if other server is now available...");
      const serverExists = await waitForValue(async () => {
        return (await this.serverDiscovery.checkServerHealth())
          ? true
          : undefined;
      });
      debug("Post-race server health check result", {
        serverExists,
      });

      const serverUrl = this.serverDiscovery.getServerUrl();
      debug("Successfully connecting as client after race condition", {
        serverUrl,
      });
      return {
        mode: "client",
        serverUrl,
      };
    }
  }

  /**
   * Launch MiroServer in this workspace
   */
  private async launchServer(): Promise<ServerLaunchResult> {
    const startTime = Date.now();
    const serverUrl = this.serverDiscovery.getServerUrl();

    debug("Starting server launch", { serverUrl });

    try {
      // Create and start server instance with proper error handling
      // Use the same port as ServerDiscovery for consistency
      const serverPort = PortConfig.getServerPort();
      const server = await MiroServer.create(
        this.featureFlagManager,
        serverPort,
      );

      const duration = Date.now() - startTime;
      debug("Server launched successfully", {
        serverUrl,
        duration: `${duration}ms`,
        mode: "server",
      });

      this.subscriptions.push(server);
      return {
        mode: "server",
        server,
        serverUrl,
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      // Port binding failed - another process is using the port
      debug("Server launch failed", {
        serverUrl,
        duration: `${duration}ms`,
        error: error instanceof Error ? error.message : String(error),
        isPortInUse:
          String(error).includes("EADDRINUSE") ||
          String(error).includes("already in use"),
      });

      throw error;
    }
  }

  /**
   * Handle server failover when current server goes down
   */
  async handleServerFailover(): Promise<ServerLaunchResult> {
    debug("Handling server failover, attempting to launch new server");

    // Try to launch a new server to replace the failed one
    return this.attemptServerLaunch();
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
    debug("Disposing ServerLauncher resources");
    this.serverDiscovery.dispose();
    this.subscriptions.forEach((subscription) => subscription.dispose());
    debug("ServerLauncher disposed");
  }
}
