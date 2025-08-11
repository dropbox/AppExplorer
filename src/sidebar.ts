/* global miro */

import { ContextProvider } from "@lit/context";
import { Task } from "@lit/task";
import "@webcomponents/webcomponentsjs";
import createDebug from "debug";
import { html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import "./lit/command-list";
import { rawMirotoneStyles } from "./lit/mirotone";
import "./lit/server-status";
import { connectSidebarSocket, socketContext } from "./lit/socket-context";

// Mirotone must be loaded on the host page to set all the CSS variables.
document.head.insertAdjacentHTML(
  "beforeend",
  `<style>${rawMirotoneStyles}</style>`,
);

const debug = createDebug("app-explorer:miro:sidebar");

@customElement("app-explorer-sidebar")
export class SidebarElement extends LitElement {
  private _socketTask = new Task(this, {
    args: () => [],
    task: connectSidebarSocket,
    onComplete: (socket) => {
      this._socketProvider.setValue(socket);
    },
  });

  private _socketProvider = new ContextProvider(this, {
    context: socketContext,
  });

  render() {
    if (!this._socketProvider.value) {
      return html`<p>Connecting to AppExplorer...</p>`;
    }

    return html`<app-explorer-server-status></app-explorer-server-status>
      <app-explorer-command-list></app-explorer-command-list> `;
  }
}
