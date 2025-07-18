import * as vscode from "vscode";

export interface MigrationFlags {
  // Phase 1: Infrastructure
  enableServerDiscovery: boolean;
  enableWorkspaceWebsockets: boolean;

  // Phase 2: Data Synchronization
  enableDualStorage: boolean;
  enableServerFailover: boolean;

  // Phase 3: Query Proxying
  enableQueryProxying: boolean;

  // Phase 4: Event Routing
  enableServerEventRouting: boolean;

  // Phase 5: Status Bar
  enableWebsocketStatusBar: boolean;

  // Development/Debug
  debugMode: boolean;
}

export class FeatureFlagManager {
  private flags: MigrationFlags;

  constructor(_context: vscode.ExtensionContext) {
    this.flags = this.loadConfiguration();
  }

  // Load configuration from VSCode settings
  private loadConfiguration(): MigrationFlags {
    const vscodeConfig = vscode.workspace.getConfiguration(
      "appExplorer.migration",
    );

    const flags = {
      ...this.getDefaults(),
      ...this.extractValidFlags(vscodeConfig),
    };

    // Validate flag dependencies
    this.validateFlagDependencies(flags);

    return flags;
  }

  // Extract only valid migration flags from VSCode configuration
  private extractValidFlags(
    config: vscode.WorkspaceConfiguration,
  ): Partial<MigrationFlags> {
    const validFlags: Partial<MigrationFlags> = {};
    const flagKeys: (keyof MigrationFlags)[] = [
      "enableServerDiscovery",
      "enableWorkspaceWebsockets",
      "enableDualStorage",
      "enableServerFailover",
      "enableQueryProxying",
      "enableServerEventRouting",
      "enableWebsocketStatusBar",
      "debugMode",
    ];

    for (const key of flagKeys) {
      const value = config.get<boolean>(key);
      if (typeof value === "boolean") {
        validFlags[key] = value;
      }
    }

    return validFlags;
  }

  // Validate flag dependencies and logical constraints
  private validateFlagDependencies(flags: MigrationFlags): void {
    const warnings: string[] = [];

    // Phase dependencies: later phases require earlier phases
    if (flags.enableDualStorage && !flags.enableWorkspaceWebsockets) {
      warnings.push(
        "enableDualStorage requires enableWorkspaceWebsockets to be enabled",
      );
    }

    if (flags.enableServerFailover && !flags.enableDualStorage) {
      warnings.push(
        "enableServerFailover requires enableDualStorage to be enabled",
      );
    }

    if (flags.enableQueryProxying && !flags.enableWorkspaceWebsockets) {
      warnings.push(
        "enableQueryProxying requires enableWorkspaceWebsockets to be enabled",
      );
    }

    if (flags.enableServerEventRouting && !flags.enableQueryProxying) {
      warnings.push(
        "enableServerEventRouting requires enableQueryProxying to be enabled",
      );
    }

    if (flags.enableWebsocketStatusBar && !flags.enableServerEventRouting) {
      warnings.push(
        "enableWebsocketStatusBar requires enableServerEventRouting to be enabled",
      );
    }

    // Log warnings if any dependency issues found
    if (warnings.length > 0) {
      console.warn("AppExplorer Migration Flag Warnings:");
      warnings.forEach((warning) => console.warn(`  - ${warning}`));
    }
  }

  private getDefaults(): MigrationFlags {
    return {
      // Phase 1: Infrastructure - disabled by default for safe rollout
      enableServerDiscovery: false,
      enableWorkspaceWebsockets: false,

      // Phase 2: Data Synchronization - disabled by default
      enableDualStorage: false,
      enableServerFailover: false,

      // Phase 3: Query Proxying - disabled by default
      enableQueryProxying: false,

      // Phase 4: Event Routing - disabled by default
      enableServerEventRouting: false,

      // Phase 5: Status Bar - disabled by default
      enableWebsocketStatusBar: false,

      // Development/Debug - disabled by default
      debugMode: false,
    };
  }

  isEnabled(flag: keyof MigrationFlags): boolean {
    return this.flags[flag];
  }

  // Check if a phase is properly enabled with all dependencies
  isPhaseEnabled(phase: 1 | 2 | 3 | 4 | 5): boolean {
    switch (phase) {
      case 1:
        return (
          this.flags.enableServerDiscovery &&
          this.flags.enableWorkspaceWebsockets
        );
      case 2:
        return (
          this.isPhaseEnabled(1) &&
          this.flags.enableDualStorage &&
          this.flags.enableServerFailover
        );
      case 3:
        return this.isPhaseEnabled(2) && this.flags.enableQueryProxying;
      case 4:
        return this.isPhaseEnabled(3) && this.flags.enableServerEventRouting;
      case 5:
        return this.isPhaseEnabled(4) && this.flags.enableWebsocketStatusBar;
      default:
        return false;
    }
  }

  getFlags(): Readonly<MigrationFlags> {
    return { ...this.flags };
  }

  // Reload configuration from VSCode settings
  reloadConfiguration(): void {
    this.flags = this.loadConfiguration();
  }
}
