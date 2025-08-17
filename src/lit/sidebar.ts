import "@webcomponents/webcomponentsjs";
import { css, html } from "lit";
import { customElement } from "lit/decorators.js";
import { createDebug } from "../utils/create-debug";
import "./app-card";
import { AppElement } from "./app-element";
import "./cards-around-cursor";
import { mirotoneStyles, rawMirotoneStyles } from "./mirotone";
import "./onboarding";
import "./server-status";
import { SocketProvider } from "./socket-context";
// Mirotone must be loaded on the host page to set all the CSS variables.
document.head.insertAdjacentHTML(
  "beforeend",
  `<style>${rawMirotoneStyles}</style>`,
);

const debug = createDebug("app-explorer:miro:sidebar");

@customElement("app-explorer-sidebar")
export class SidebarElement extends AppElement {
  static styles = [
    mirotoneStyles,
    css`
      .card-list {
        display: flex;
        flex-direction: column;
        gap: var(--space-medium);
        overflow-y: auto;
      }

      app-explorer-sidebar {
        display: flex;
        flex-direction: column;
        max-height: 100%;
      }

      .commands {
        padding: 0 var(--space-medium);
      }
    `,
  ];

  private _socketProvider = new SocketProvider(this);

  render() {
    if (!this._socketProvider.value) {
      return html`<p>Connecting to AppExplorer...</p>`;
    }

    return html`
      <app-explorer-cards-around-cursor></app-explorer-cards-around-cursor>
    `;
  }
}
