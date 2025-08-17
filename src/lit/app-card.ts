import classNames from "classnames";
import { css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ifDefined } from "lit/directives/if-defined.js";
import { CardData } from "../EventTypes";
import { createDebug } from "../utils/create-debug";
import { AppElement } from "./app-element";
import { mirotoneStyles } from "./mirotone";

const debug = createDebug("app-explorer:lit:app-card");

@customElement("app-card")
export class AppCardElement extends AppElement {
  static styles = [
    mirotoneStyles,
    css`
      .screen-reader-text {
        position: absolute;
        left: -9999px;
      }

      .app-card--title {
        overflow: hidden;
        white-space: nowrap;
        direction: rtl;
        text-align: left;
        text-overflow: ellipsis;
      }

      .code-link {
        position: absolute;
        top: 24px;
        right: 0;
      }

      app-card .app-card {
        width: 100%;
        max-width: unset;
      }

      .app-card--app-logo {
        position: absolute;
        right: 1rem;
        bottom: 1rem;
      }

      .hideTags .app-card--tags .symbol-tag {
        display: none;
      }
    `,
  ];

  @property({ type: Boolean })
  hideTags = false;

  @property({ type: Boolean })
  attachSelected: boolean = true;

  @property({ type: Object })
  cardData!: CardData;

  @property({ type: Boolean })
  miroDraggable = true;

  @state()
  private faviconIndex = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected willUpdate(changed: any) {
    if (changed.has("cardData")) {
      this.faviconIndex = 0;
    }
  }

  private getFaviconCandidates(): string[] {
    const link = this.cardData?.codeLink;
    if (!link) {
      return [];
    }
    try {
      const u = new URL(link);
      const host = u.hostname;
      const origin = u.origin;
      return [
        `https://icons.duckduckgo.com/ip3/${host}.ico`,
        `https://www.google.com/s2/favicons?domain=${host}&sz=64`,
        `${origin}/favicon.ico`,
      ];
    } catch {
      return [];
    }
  }

  private onFaviconError = (ev: Event) => {
    const img = ev.currentTarget as HTMLImageElement;
    const candidates = this.getFaviconCandidates();
    this.faviconIndex++;
    const next = candidates[this.faviconIndex];
    img.src = next ?? "/AppExplorer.svg"; // final fallback
  };

  render() {
    const candidates = this.getFaviconCandidates();
    const faviconSrc =
      candidates.length > 0 ? candidates[0] : "/AppExplorer.svg";

    return html`
      <div
        draggable="false"
        class=${classNames("app-card", {
          hideTags: this.hideTags,
          "miro-draggable": this.miroDraggable,
        })}
        data-attach-selected=${this.attachSelected}
        data-card="${JSON.stringify(this.cardData)}"
      >
        <h1 class="app-card--title">
          <span>${this.cardData.title}</span>
        </h1>
        <h1 class="app-card--description p-medium"></h1>
        <div class="app-card--body">
          <div class="app-card--tags">
            <span class="tag">${this.cardData.path}</span>
            <span class="tag symbol-tag">${this.cardData.symbol}</span>
          </div>

          ${html`
            <a
              href=${ifDefined(this.cardData.codeLink!)}
              target="_blank"
              class="code-link"
            >
              ${this.cardData?.codeLink
                ? html`<img
                    src=${faviconSrc}
                    @error=${this.onFaviconError}
                    alt="site icon"
                    width="16"
                    height="16"
                    style="vertical-align: middle; margin-right: 6px"
                  />`
                : null}
              <span class="screen-reader-text"> Open code </span>
            </a>
          `}

          <img class="app-card--app-logo" src="/AppExplorer.svg" />
        </div>
      </div>
    `;
  }
}
