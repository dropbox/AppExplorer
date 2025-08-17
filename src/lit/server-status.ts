import { consume } from "@lit/context";
import { Task } from "@lit/task";
import createDebug from "debug";
import { css, html } from "lit";
import { customElement } from "lit/decorators.js";
import { AppElement } from "./app-element";
import { mirotoneStyles } from "./mirotone";
import { ServerStatusController } from "./server-status-controller";
import { SidebarSocket, socketContext } from "./socket-context";

const debug = createDebug("app-explorer:server-status");

@customElement("app-explorer-server-status")
export class ServerStatusElement extends AppElement {
  static styles = [
    mirotoneStyles,
    css`
      .selected {
        background-color: var(--colors-blue-250);
      }

      app-explorer-server-status {
        padding: 0 var(--space-small);
      }
    `,
  ];

  @consume({ context: socketContext })
  _socket!: SidebarSocket;

  private serverStatusController = new ServerStatusController(this);

  private _miroBoard = new Task(this, {
    args: () => [miro],
    task: async ([miro]) => {
      const boardInfo = await miro?.board.getInfo();
      return boardInfo?.id;
    },
  });

  render() {
    const boardId = this._miroBoard.value;
    const data = this.serverStatusController.value;
    debug("render", { boardId, data });

    if (!data) {
      return html`<p>Loading server status...</p>`;
    }

    return html`
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
                <td>
                  Miro Board<br />
                  (${data.cardsPerBoard[board.boardId] ?? 0} cards)
                </td>
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
    `;
  }
}
