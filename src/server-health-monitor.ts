import createDebug from "debug";
import { FeatureFlagManager } from "./feature-flag-manager";
import { ServerDiscovery } from "./server-discovery";
import { ServerLauncher } from "./server-launcher";
import { WorkspaceCardStorage } from "./workspace-card-storage";

const debug = createDebug("app-explorer:health-monitor");

export type HealthStatus = "healthy" | "unhealthy" | "unknown";

export interface HealthMonitorOptions {
  checkInterval: number; // How often to check health (ms)
  failureThreshold: number; // How many failures before considering server down
  recoveryThreshold: number; // How many successes before considering server recovered
}

export const DEFAULT_HEALTH_MONITOR_OPTIONS: HealthMonitorOptions = {
  checkInterval: 10000, // 10 seconds
  failureThreshold: 3, // 3 consecutive failures
  recoveryThreshold: 2, // 2 consecutive successes
};

export interface HealthEvent {
  type: "health_change" | "failover_triggered" | "recovery_detected";
  status: HealthStatus;
  timestamp: Date;
  details?: string;
}

export type HealthEventHandler = (event: HealthEvent) => void | Promise<void>;

export class ServerHealthMonitor {
  private serverDiscovery: ServerDiscovery;
  private featureFlagManager: FeatureFlagManager;
  private serverLauncher: ServerLauncher;
  private cardStorage: WorkspaceCardStorage;
  private options: HealthMonitorOptions;

  private monitorInterval?: NodeJS.Timeout;
  private currentStatus: HealthStatus = "unknown";
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private isMonitoring = false;
  private eventHandlers: HealthEventHandler[] = [];

  constructor(
    serverDiscovery: ServerDiscovery,
    featureFlagManager: FeatureFlagManager,
    serverLauncher: ServerLauncher,
    cardStorage: WorkspaceCardStorage,
    options: Partial<HealthMonitorOptions> = {},
  ) {
    this.serverDiscovery = serverDiscovery;
    this.featureFlagManager = featureFlagManager;
    this.serverLauncher = serverLauncher;
    this.cardStorage = cardStorage;
    this.options = { ...DEFAULT_HEALTH_MONITOR_OPTIONS, ...options };
  }

  /**
   * Start health monitoring
   */
  startMonitoring(): void {
    if (this.isMonitoring) {
      return;
    }

    this.isMonitoring = true;
    debug("Starting server health monitoring", {
      interval: this.options.checkInterval,
      failureThreshold: this.options.failureThreshold,
    });

    this.monitorInterval = setInterval(async () => {
      await this.performHealthCheck();
    }, this.options.checkInterval);

    // Perform initial health check
    this.performHealthCheck();
  }

  /**
   * Stop health monitoring
   */
  stopMonitoring(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = undefined;
    }
    this.isMonitoring = false;
    debug("Stopped server health monitoring");
  }

  /**
   * Perform a single health check
   */
  private async performHealthCheck(): Promise<void> {
    try {
      const isHealthy = await this.serverDiscovery.checkServerHealth();

      if (isHealthy) {
        this.consecutiveFailures = 0;
        this.consecutiveSuccesses++;

        // Check if we've recovered from an unhealthy state
        if (
          this.currentStatus === "unhealthy" &&
          this.consecutiveSuccesses >= this.options.recoveryThreshold
        ) {
          await this.handleRecovery();
        } else if (this.currentStatus === "unknown") {
          await this.updateStatus("healthy", "Server health check successful");
        }
      } else {
        this.consecutiveSuccesses = 0;
        this.consecutiveFailures++;

        // Check if we've crossed the failure threshold
        if (
          this.currentStatus !== "unhealthy" &&
          this.consecutiveFailures >= this.options.failureThreshold
        ) {
          await this.handleFailure();
        }
      }
    } catch (error) {
      debug("Health check error", { error });
      this.consecutiveSuccesses = 0;
      this.consecutiveFailures++;

      if (
        this.currentStatus !== "unhealthy" &&
        this.consecutiveFailures >= this.options.failureThreshold
      ) {
        await this.handleFailure();
      }
    }
  }

  /**
   * Handle server failure detection
   */
  private async handleFailure(): Promise<void> {
    await this.updateStatus(
      "unhealthy",
      `Server failed after ${this.consecutiveFailures} consecutive failures`,
    );

    // Emit failover event
    this.emitEvent({
      type: "failover_triggered",
      status: "unhealthy",
      timestamp: new Date(),
      details: `Server health check failed ${this.consecutiveFailures} times`,
    });

    await this.attemptFailover();
  }

  /**
   * Handle server recovery detection
   */
  private async handleRecovery(): Promise<void> {
    await this.updateStatus(
      "healthy",
      `Server recovered after ${this.consecutiveSuccesses} consecutive successes`,
    );

    this.emitEvent({
      type: "recovery_detected",
      status: "healthy",
      timestamp: new Date(),
      details: `Server health restored after ${this.consecutiveSuccesses} successful checks`,
    });
  }

  /**
   * Attempt server failover
   */
  private async attemptFailover(): Promise<void> {
    if (this.featureFlagManager.isEnabled("debugMode")) {
      debug("AppExplorer: Attempting server failover...");
    }

    try {
      const result = await this.serverLauncher.handleServerFailover();

      if (result.mode === "server" && result.server) {
        if (this.featureFlagManager.isEnabled("debugMode")) {
          debug("AppExplorer: Successfully launched replacement server");
        }

        // Reset health status since we now have a new server
        this.consecutiveFailures = 0;
        this.consecutiveSuccesses = 0;
        await this.updateStatus(
          "healthy",
          "Replacement server launched successfully",
        );
      } else if (result.mode === "client") {
        if (this.featureFlagManager.isEnabled("debugMode")) {
          debug(
            "AppExplorer: Another workspace launched replacement server, connecting as client",
          );
        }

        // Another workspace handled the failover
        this.consecutiveFailures = 0;
        this.consecutiveSuccesses = 0;
        await this.updateStatus("healthy", "Connected to replacement server");
      } else {
        debug("AppExplorer: Failover attempt failed:", result.error);
      }
    } catch (error) {
      debug("AppExplorer: Failover attempt failed:", error);
    }
  }

  /**
   * Update current health status
   */
  private async updateStatus(
    status: HealthStatus,
    details: string,
  ): Promise<void> {
    if (this.currentStatus !== status) {
      this.currentStatus = status;

      if (this.featureFlagManager.isEnabled("debugMode")) {
        debug(
          `AppExplorer: Server health status changed to ${status}: ${details}`,
        );
      }

      this.emitEvent({
        type: "health_change",
        status,
        timestamp: new Date(),
        details,
      });
    }
  }

  /**
   * Add event handler
   */
  onHealthEvent(handler: HealthEventHandler): void {
    this.eventHandlers.push(handler);
  }

  /**
   * Remove event handler
   */
  removeHealthEventHandler(handler: HealthEventHandler): void {
    const index = this.eventHandlers.indexOf(handler);
    if (index >= 0) {
      this.eventHandlers.splice(index, 1);
    }
  }

  /**
   * Emit health event to all handlers
   */
  private emitEvent(event: HealthEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        debug("AppExplorer: Error in health event handler:", error);
      }
    }
  }

  /**
   * Get current health status
   */
  getCurrentStatus(): HealthStatus {
    return this.currentStatus;
  }

  /**
   * Get health statistics
   */
  getHealthStats(): {
    status: HealthStatus;
    consecutiveFailures: number;
    consecutiveSuccesses: number;
    isMonitoring: boolean;
  } {
    return {
      status: this.currentStatus,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      isMonitoring: this.isMonitoring,
    };
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.stopMonitoring();
    this.eventHandlers = [];
  }
}
