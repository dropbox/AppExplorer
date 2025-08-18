import { PortConfig } from "./port-config";
import { createDebug } from "./utils/create-debug";
const debug = createDebug("app-explorer:server-discovery");

export interface ServerDiscoveryOptions {
  port: number;
  host: string;
  healthCheck: {
    endpoint: string; // Health check endpoint path
    timeout: number; // Request timeout in milliseconds
  };
}

/**
 * Get default server options with configured port
 * Uses PortConfig to determine the appropriate port (production default or test override)
 *
 * ⚠️ IMPORTANT: Production Miro integration MUST use port 9042.
 * Port configuration is only intended for E2E testing purposes.
 */
function getDefaultServerOptions(): ServerDiscoveryOptions {
  return {
    port: PortConfig.getServerPort(),
    host: "localhost",
    healthCheck: {
      endpoint: "/health",
      timeout: 5000, // 5 seconds
    },
  };
}

export class ServerDiscovery {
  private options: ServerDiscoveryOptions;
  private healthCheckInterval?: NodeJS.Timeout;
  private lastHealthCheck?: Date;
  private consecutiveFailures = 0;

  constructor(options: Partial<ServerDiscoveryOptions> = {}) {
    this.options = { ...getDefaultServerOptions(), ...options };
    debug("ServerDiscovery initialized", { options: this.options });
  }

  /**
   * Check if a server is running on the configured port
   */
  async checkServerHealth(): Promise<boolean> {
    const url = `http://${this.options.host}:${this.options.port}${this.options.healthCheck.endpoint}`;
    const startTime = Date.now();

    try {
      debug("Starting server health check", { url });

      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.options.healthCheck.timeout,
      );

      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
        },
      });

      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;

      if (response.ok) {
        this.consecutiveFailures = 0;
        this.lastHealthCheck = new Date();

        debug("Server health check successful", {
          url,
          status: response.status,
          duration: `${duration}ms`,
          consecutiveFailures: this.consecutiveFailures,
        });

        return true;
      } else {
        this.consecutiveFailures++;

        debug("Server health check failed - non-200 response", {
          url,
          status: response.status,
          statusText: response.statusText,
          duration: `${duration}ms`,
          consecutiveFailures: this.consecutiveFailures,
        });

        return false;
      }
    } catch (error) {
      this.consecutiveFailures++;
      const duration = Date.now() - startTime;

      debug("Server health check failed - network error", {
        url,
        error: error instanceof Error ? error.message : String(error),
        duration: `${duration}ms`,
        consecutiveFailures: this.consecutiveFailures,
        isTimeout: error instanceof Error && error.name === "AbortError",
      });

      return false;
    }
  }

  /**
   * Stop health monitoring
   */
  stopHealthMonitoring(): void {
    if (this.healthCheckInterval) {
      debug("Stopping server health monitoring");
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }
  }

  /**
   * Get the server URL for websocket connections
   */
  getServerUrl(): string {
    return `http://${this.options.host}:${this.options.port}`;
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    debug("Disposing ServerDiscovery resources");
    this.stopHealthMonitoring();
    debug("ServerDiscovery disposed");
  }
}
