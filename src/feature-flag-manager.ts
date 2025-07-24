import * as vscode from "vscode";
import { createLogger } from "./logger";

export interface MigrationFlags {
  // Development/Debug
  debugMode: boolean;
}

export class FeatureFlagManager {
  private flags: MigrationFlags;
  private logger = createLogger("feature-flags");

  constructor(_context: vscode.ExtensionContext) {
    this.logger.debug("Initializing FeatureFlagManager");
    this.flags = this.loadConfiguration();
  }

  // Load configuration from VSCode settings
  private loadConfiguration(): MigrationFlags {
    this.logger.debug("Loading feature flag configuration");

    const vscodeConfig = vscode.workspace.getConfiguration(
      "appExplorer.migration",
    );

    const flags = {
      ...this.getDefaults(),
      ...this.extractValidFlags(vscodeConfig),
    };

    // Validate flag dependencies
    this.validateFlagDependencies(flags);

    this.logger.info("Feature flags loaded", {
      debugMode: flags.debugMode,
    });

    return flags;
  }

  // Extract only valid migration flags from VSCode configuration
  private extractValidFlags(
    config: vscode.WorkspaceConfiguration,
  ): Partial<MigrationFlags> {
    const validFlags: Partial<MigrationFlags> = {};
    const flagKeys: (keyof MigrationFlags)[] = ["debugMode"];

    for (const key of flagKeys) {
      const value = config.get<boolean>(key);
      if (typeof value === "boolean") {
        validFlags[key] = value;
      }
    }

    return validFlags;
  }

  /**
   * Some feature flags may depend on others. This is where to check and make
   * sure a later flag isn't on while a flag it requires is off.
   */
  private validateFlagDependencies(_flags: MigrationFlags): void {}

  private getDefaults(): MigrationFlags {
    return {
      // Development/Debug - disabled by default
      debugMode: false,
    };
  }

  isEnabled(flag: keyof MigrationFlags): boolean {
    const isEnabled = this.flags[flag];

    return isEnabled;
  }

  getFlags(): Readonly<MigrationFlags> {
    return { ...this.flags };
  }

  // Reload configuration from VSCode settings
  reloadConfiguration(): void {
    this.logger.info("Reloading feature flag configuration");
    const oldFlags = { ...this.flags };
    this.flags = this.loadConfiguration();

    // Log any changes
    const changes: string[] = [];
    for (const key of Object.keys(this.flags) as (keyof MigrationFlags)[]) {
      if (oldFlags[key] !== this.flags[key]) {
        changes.push(`${key}: ${oldFlags[key]} → ${this.flags[key]}`);
      }
    }

    if (changes.length > 0) {
      this.logger.info("Feature flag changes detected", { changes });
    } else {
      this.logger.debug("No feature flag changes detected");
    }
  }
}
