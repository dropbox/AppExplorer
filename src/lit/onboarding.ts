import { css, html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import { mirotoneStyles } from "./mirotone";

@customElement("app-explorer-onboarding")
export class OnboardingElement extends LitElement {
  static styles = [
    mirotoneStyles,
    css`
      .message-graphic {
        margin-top: var(--space-medium);
      }
      .message-buttons {
        display: flex;
        justify-content: center;
      }
      .message-text {
        text-align: center;
      }
    `,
  ];

  render() {
    return html`
      <div class="grid">
        <div class="cs3 ce11">
          <img
            class="message-graphic"
            src="https://mirotone.xyz/onboarding.svg"
            width="224"
          />
        </div>
        <div class="cs1 ce12 message-text">
          <p class="p-large">
            With AppExplorer you can bookmark code references in your Miro
            boards!
          </p>
          <p>
            To get started use the
            <a
              href="https://code.visualstudio.com/docs/getstarted/userinterface#_command-palette"
            >
              Command Palette
            </a>
            to run <strong>AppExplorer: Create Card</strong>
          </p>
          <ol>
            <li>
              The command will prompt you to select which symbol to create a
              card for. The list is filtered to only show symbols surrounding
              the cursor.
            </li>
            <li>
              <p>Once selected, you can set the name of the card.</p>
            </li>
            <li>
              <p>
                On the Miro board if you click the icon in the top-right corner,
                it will navigate back to that symbol in VSCode.
              </p>
            </li>
          </ol>
        </div>
      </div>
    `;
  }
}
