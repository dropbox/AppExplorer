import * as net from "net";
import { PortConfig } from "../../port-config";

/**
 * Test Port Manager - Handles dynamic port allocation for E2E tests
 * This prevents conflicts with running production AppExplorer instances
 *
 * Uses process-scoped runtime port overrides instead of global VSCode settings
 * to enable parallel test execution without conflicts.
 */
export class TestPortManager {
  private static allocatedPort: number | null = null;
  private static readonly TEST_PORT_RANGE_START = 9043;
  private static readonly TEST_PORT_RANGE_END = 9999;
  private static isInitialized = false;

  /**
   * Allocate a random available port for testing and set it as runtime override
   * This ensures tests don't conflict with production AppExplorer instances
   * Uses process-scoped runtime overrides instead of VSCode settings
   */
  static async allocateTestPort(): Promise<number> {
    if (this.allocatedPort) {
      // Return previously allocated port if still available
      if (await this.isPortAvailable(this.allocatedPort)) {
        // Ensure runtime override is still set
        PortConfig.setRuntimePortOverride(this.allocatedPort);
        return this.allocatedPort;
      } else {
        // Port is no longer available, allocate a new one
        this.allocatedPort = null;
        PortConfig.setRuntimePortOverride(null);
      }
    }

    // Try to find an available port in the test range
    for (let attempt = 0; attempt < 50; attempt++) {
      const port = this.generateRandomPort();

      if (await this.isPortAvailable(port)) {
        this.allocatedPort = port;
        // Set runtime port override (process-scoped, not persisted)
        PortConfig.setRuntimePortOverride(port);
        this.isInitialized = true;

        console.log(
          `[TestPortManager] Allocated test port ${port} (process-scoped)`,
        );
        return port;
      }
    }

    throw new Error(
      `Failed to allocate test port after 50 attempts. Range: ${this.TEST_PORT_RANGE_START}-${this.TEST_PORT_RANGE_END}`,
    );
  }

  /**
   * Get the currently allocated test port
   * Throws if no port has been allocated yet
   */
  static getAllocatedPort(): number {
    if (!this.allocatedPort) {
      throw new Error(
        "No test port has been allocated. Call allocateTestPort() first.",
      );
    }
    return this.allocatedPort;
  }

  /**
   * Check if the allocated port is still available
   */
  static async isAllocatedPortAvailable(): Promise<boolean> {
    if (!this.allocatedPort) {
      return false;
    }
    return this.isPortAvailable(this.allocatedPort);
  }

  /**
   * Release the allocated port and clear runtime override
   */
  static releasePort(): void {
    if (this.allocatedPort) {
      console.log(
        `[TestPortManager] Releasing test port ${this.allocatedPort}`,
      );
      this.allocatedPort = null;
      PortConfig.setRuntimePortOverride(null);
      this.isInitialized = false;
    }
  }

  /**
   * Get the test server URL for the allocated port
   */
  static getTestServerUrl(): string {
    const port = this.getAllocatedPort();
    return `http://localhost:${port}`;
  }

  /**
   * Generate a random port in the test range
   */
  private static generateRandomPort(): number {
    const range = this.TEST_PORT_RANGE_END - this.TEST_PORT_RANGE_START + 1;
    return this.TEST_PORT_RANGE_START + Math.floor(Math.random() * range);
  }

  /**
   * Check if a port is available for binding
   */
  private static async isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();

      server.listen(port, () => {
        server.close(() => {
          resolve(true);
        });
      });

      server.on("error", () => {
        resolve(false);
      });
    });
  }

  /**
   * Wait for a port to become available (useful for server startup)
   */
  static async waitForPortToBeInUse(
    port: number,
    timeoutMs: number = 10000,
    intervalMs: number = 100,
  ): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const available = await this.isPortAvailable(port);
      if (!available) {
        // Port is in use, which means server is running
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(
      `Port ${port} did not become available within ${timeoutMs}ms`,
    );
  }

  /**
   * Check if the test port manager has been initialized
   */
  static isTestPortInitialized(): boolean {
    return this.isInitialized && this.allocatedPort !== null;
  }

  /**
   * Get diagnostic information about port allocation
   */
  static async getDiagnostics(): Promise<{
    allocatedPort: number | null;
    allocatedPortAvailable: boolean;
    testServerUrl: string | null;
    isInitialized: boolean;
    runtimeOverride: number | null;
    portConfigDiagnostics: ReturnType<typeof PortConfig.getDiagnostics>;
  }> {
    const allocatedPortAvailable = this.allocatedPort
      ? await this.isPortAvailable(this.allocatedPort)
      : false;

    return {
      allocatedPort: this.allocatedPort,
      allocatedPortAvailable,
      testServerUrl: this.allocatedPort ? this.getTestServerUrl() : null,
      isInitialized: this.isInitialized,
      runtimeOverride: PortConfig.getRuntimePortOverride(),
      portConfigDiagnostics: PortConfig.getDiagnostics(),
    };
  }
}
