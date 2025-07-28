import { Socket, io as socketIO } from "socket.io-client";
import * as vscode from "vscode";
import { CardStorage, StorageAdapter } from "./card-storage";
import { logger } from "./logger";

const log = logger.withPrefix("workspace-card-proxy");

export class WorkspaceCardStorageProxy
  extends CardStorage
  implements vscode.Disposable
{
  private selectedIds: string[] = [];
  public readonly socket: Socket;

  constructor(storageAdapter: StorageAdapter, serverUrl: string) {
    super(storageAdapter);

    const wsUrl = `${serverUrl}/workspace`;
    const connectionTimeout = 10000; // 10 second connection timeout

    this.socket = socketIO(wsUrl, {
      transports: ["websocket"],
      timeout: connectionTimeout,
      reconnection: true,
      forceNew: true, // Force new connection on each attempt
    });
  }

  getSelectedCardIDs(): string[] {
    return this.selectedIds;
  }

  dispose(): void {
    log.debug("WorkspaceCardStorageProxy disposed");
  }
}
