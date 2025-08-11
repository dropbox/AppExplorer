/* global miro */

import { ContextProvider } from "@lit/context";
import { Task } from "@lit/task";
import "@webcomponents/webcomponentsjs";
import createDebug from "debug";
import { css, html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import { connectSidebarSocket, socketContext } from "./lit/socket-context";

const debug = createDebug("app-explorer:miro:sidebar");

@customElement("app-explorer-sidebar")
class SidebarElement extends LitElement {
  static styles = css`
    .selected {
      background-color: var(--colors-blue-250);
    }
  `;

  private _socketTask = new Task(this, {
    args: () => [],
    task: () => {
      return connectSidebarSocket();
    },
    onComplete: (socket) => {
      debug("onComplete", this._socketTask.value);
      this._socketProvider.setValue(socket);
    },
  });

  private _socketProvider = new ContextProvider(this, {
    context: socketContext,
  });

  private _serverStatus = new Task(this, {
    args: () => [this._socketTask.taskComplete] as const,
    autoRun: true,
    task: async ([socketPromise]) => {
      const socket = await socketPromise;
      const serverStatus = await socket.emitWithAck("getServerStatus");
      debug("serverStatus", serverStatus);
      return serverStatus;
    },
  });

  private _miroBoard = new Task(this, {
    args: () => [miro],
    task: async ([miro]) => {
      const boardInfo = await miro?.board.getInfo();
      return boardInfo?.id;
    },
  });

  render() {
    const boardId = this._miroBoard.value;

    debug("render", { boardId });
    return this._serverStatus.render({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      error: (error: any) => html`<div>Error: ${error.message}</div>`,
      pending: () => html`<div>Getting server status...</div>`,
      complete: (data) => html`
        <link
          rel="stylesheet"
          href="https://unpkg.com/mirotone@^5/dist/styles.css"
        />
        <p>AppExplorer is connected to the following clients.</p>
        <table class="table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Name</th>
            </tr>
          </thead>
          <tbody>
            ${data?.allBoards.map(
              (board) => html`
                <tr class="${board.boardId === boardId ? "selected" : ""}">
                  <td>Miro Board</td>
                  <td>
                    ${board.name}
                    ${board.boardId === boardId ? html` (current)` : html``}
                  </td>
                </tr>
              `,
            )}
            ${data?.connectedWorkspaces.map(
              (workspace) => html`
                <tr>
                  <td>Workspace</td>
                  <td>${workspace.rootPath ?? workspace.id}</td>
                </tr>
              `,
            )}
          </tbody>
        </table>
      `,
    });
  }
}
