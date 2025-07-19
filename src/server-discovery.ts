import { DEFAULT_HEALTH_CHECK_CONFIG, ServerHealthCheck } from "./EventTypes";
import { createLogger } from "./logger";

export interface ServerDiscoveryOptions {
  port: number;
  host: string;
  healthCheck: ServerHealthCheck;
}

export const DEFAULT_SERVER_OPTIONS: ServerDiscoveryOptions = {
  port: 9042,
  host: "localhost",
  healthCheck: DEFAULT_HEALTH_CHECK_CONFIG,
};

export class ServerDiscovery {
  private options: ServerDiscoveryOptions;
  private healthCheckInterval?: NodeJS.Timeout;
  private lastHealthCheck?: Date;
  private consecutiveFailures = 0;
  private logger = createLogger("server-discovery");

  constructor(options: Partial<ServerDiscoveryOptions> = {}) {
    this.options = { ...DEFAULT_SERVER_OPTIONS, ...options };
    this.logger.debug("ServerDiscovery initialized", { options: this.options });
  }

  /**
   * Check if a server is running on the configured port
   */
  async checkServerHealth(): Promise<boolean> {
    const url = `http://${this.options.host}:${this.options.port}${this.options.healthCheck.endpoint}`;
    const startTime = Date.now();

    try {
      this.logger.debug("Starting server health check", { url });

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

        this.logger.debug("Server health check successful", {
          url,
          status: response.status,
          duration: `${duration}ms`,
          consecutiveFailures: this.consecutiveFailures,
        });

        return true;
      } else {
        this.consecutiveFailures++;

        this.logger.warn("Server health check failed - non-200 response", {
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

      this.logger.warn("Server health check failed - network error", {
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
   * Start periodic health monitoring
   */
  startHealthMonitoring(onHealthChange?: (isHealthy: boolean) => void): void {
    if (this.healthCheckInterval) {
      this.logger.debug(
        "Stopping existing health monitoring before starting new one",
      );
      this.stopHealthMonitoring();
    }

    this.logger.info("Starting server health monitoring", {
      interval: `${this.options.healthCheck.retryInterval}ms`,
      maxRetries: this.options.healthCheck.maxRetries,
      endpoint: this.options.healthCheck.endpoint,
    });

    this.healthCheckInterval = setInterval(async () => {
      try {
        const isHealthy = await this.checkServerHealth();

        if (onHealthChange) {
          onHealthChange(isHealthy);
        }

        // If we've had too many consecutive failures, consider server down
        if (this.consecutiveFailures >= this.options.healthCheck.maxRetries) {
          this.logger.error(
            "Server appears to be down - max consecutive failures reached",
            {
              consecutiveFailures: this.consecutiveFailures,
              maxRetries: this.options.healthCheck.maxRetries,
            },
          );
          if (onHealthChange) {
            onHealthChange(false);
          }
        }
      } catch (error) {
        this.logger.error("Error during health monitoring interval", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, this.options.healthCheck.retryInterval);
  }

  /**
   * Stop health monitoring
   */
  stopHealthMonitoring(): void {
    if (this.healthCheckInterval) {
      this.logger.debug("Stopping server health monitoring");
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }
  }

  /**
   * Get current server status
   */
  getServerStatus(): {
    isHealthy: boolean;
    lastCheck?: Date;
    consecutiveFailures: number;
  } {
    return {
      isHealthy: this.consecutiveFailures === 0,
      lastCheck: this.lastHealthCheck,
      consecutiveFailures: this.consecutiveFailures,
    };
  }

  /**
   * Determine if this workspace should launch a server
   * Returns true if no server is detected
   */
  async shouldLaunchServer(): Promise<boolean> {
    const serverExists = await this.checkServerHealth();
    return !serverExists;
  }

  /**
   * Get the server URL for websocket connections
   */
  getServerUrl(): string {
    return `http://${this.options.host}:${this.options.port}`;
  }

  /**
   * Get the websocket URL for workspace connections
   */
  getWebSocketUrl(): string {
    return `ws://${this.options.host}:${this.options.port}/workspace`;
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.logger.debug("Disposing ServerDiscovery resources");
    this.stopHealthMonitoring();
    this.logger.debug("ServerDiscovery disposed");
  }
}
