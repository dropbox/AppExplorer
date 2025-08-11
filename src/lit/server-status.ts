import { consume } from "@lit/context";
import { Task } from "@lit/task";
import createDebug from "debug";
import { css, html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import { mirotoneStyles } from "./mirotone";
import { SidebarSocket, socketContext } from "./socket-context";
import { SocketSubscriptionController } from "./socket-subscription-controller";

const debug = createDebug("app-explorer:server-status");

@customElement("app-explorer-server-status")
export class ServerStatusElement extends LitElement {
  static styles = [
    mirotoneStyles,
    css`
      .selected {
        background-color: var(--colors-blue-250);
      }
    `,
  ];

  @consume({ context: socketContext })
  _socket!: SidebarSocket;

  private serverStatusController = new SocketSubscriptionController(this);

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
