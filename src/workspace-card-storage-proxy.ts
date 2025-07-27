import invariant from "tiny-invariant";
import * as vscode from "vscode";
import { CardStorage, StorageAdapter } from "./card-storage";
import { WorkspaceToMiroOperations } from "./EventTypes";
import { logger } from "./logger";
import { querySocket } from "./utils/querySocket";
import { WorkspaceWebsocketClient } from "./workspace-websocket-client";

const log = logger.withPrefix("workspace-card-proxy");

/**
 * CardStorage proxy that routes operations through workspace websocket client
 * instead of direct VSCode storage. Enables true multi-workspace support.
 *
 * This class uses composition to wrap a CardStorage instance and provides
 * the same interface while adding proxy functionality for workspace communication.
 */
export class WorkspaceCardStorageProxy
  extends CardStorage
  implements vscode.Disposable
{
  private selectedIds: string[] = [];

  constructor(
    storageAdapter: StorageAdapter,
    private workspaceClient: WorkspaceWebsocketClient,
  ) {
    super(storageAdapter);

    log.debug("WorkspaceCardStorageProxy initialized", {
      hasWorkspaceClient: !!workspaceClient,
      storageType: "vscode-backed",
    });
  }

  getSelectedCardIDs(): string[] {
    return this.selectedIds;
  }

  dispose(): void {
    this.removeAllListeners();
    log.debug("WorkspaceCardStorageProxy disposed");
  }

  async query<Key extends keyof WorkspaceToMiroOperations>(
    boardId: string,
    queryName: Key,
    ...args: Parameters<WorkspaceToMiroOperations[Key]>
  ): Promise<any> {
    // Enhanced logging for all query operations
    log.info("🔄 PROXY QUERY: Starting query operation", {
      timestamp: new Date().toISOString(),
      boardId,
      queryName,
      argsCount: args.length,
      hasWorkspaceClient: !!this.workspaceClient,
      direction: "proxy->server",
    });

    try {
      const socket = this.workspaceClient.getSocket();
      invariant(socket, "No workspace socket");
      return querySocket(socket, boardId, queryName, ...args);
    } catch (error) {
      log.error("❌ Failed to execute query via proxy", {
        timestamp: new Date().toISOString(),
        boardId,
        queryName,
        args: args.map((arg, i) => ({ index: i, type: typeof arg })),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
