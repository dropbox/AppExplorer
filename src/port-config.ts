/**
 * Default production port for AppExplorer server
 * This MUST be 9042 for production Miro integration
 */
export const DEFAULT_PRODUCTION_PORT = 9042;

/**
 * Simplified port configuration utility for AppExplorer server
 *
 * Reads APP_EXPLORER_PORT environment variable if set, otherwise uses production default (9042)
 */
export class PortConfig {
  /**
   * Get the configured server port
   *
   * Reads APP_EXPLORER_PORT environment variable if set, otherwise returns production default (9042)
   */
  static getServerPort(): number {
    const envPort = process.env.APP_EXPLORER_PORT;
    if (envPort) {
      const portNumber = parseInt(envPort, 10);
      if (!isNaN(portNumber) && portNumber >= 9042 && portNumber <= 9999) {
        return portNumber;
      }
    }
    return DEFAULT_PRODUCTION_PORT;
  }
}
