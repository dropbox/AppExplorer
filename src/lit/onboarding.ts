import { css, html } from "lit";
import { customElement } from "lit/decorators.js";
import { CardData } from "../EventTypes";
import { AppElement } from "./app-element";
import { mirotoneStyles } from "./mirotone";

@customElement("app-explorer-onboarding")
export class OnboardingElement extends AppElement {
  static styles = [
    mirotoneStyles,
    css`
      /* Minimal custom styling – leverage existing Mirotone tokens */
      .empty-state {
        border: var(--border-widths-sm) dashed var(--indigo200, #d0d7de);
        border-radius: var(--sizes-1);
        background: var(--white, #fff);
        padding: var(--sizes-2) var(--sizes-3);
        font-size: var(--font-sizes-175);
        line-height: 1.4;
        display: flex;
        flex-direction: column;
        gap: var(--sizes-2);
      }
      .empty-state code {
        background: var(--indigo50, #f6f8fa);
        padding: 0 4px;
        border-radius: var(--sizes-1);
        font-family: var(--fonts-monospace, monospace);
        font-size: 0.9em;
      }
      .steps {
        margin: 0 0 0 var(--sizes-3);
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .steps li {
        margin: 0;
      }
      .secondary {
        margin: 0;
        color: var(--indigo500, #57606a);
        font-size: var(--font-sizes-150);
      }

      ul.onboarding-faq li strong {
        display: block;
      }
    `,
  ];

  render() {
    return html`
      <div class="empty-state" data-testid="no-symbols-onboarding">
        <div class="grid">
          <div class="cs1 ce12">
            <h3 class="h3" style="margin:0;">Explore your code here</h3>
          </div>
          <div class="cs1 ce12">
            <p class="secondary">
              This panel shows functions, classes & symbols near your cursor so
              you can drag them onto the board.
            </p>
          </div>
          <div class="cs2 ce12">
            <ol class="steps">
              <li>
                Open a source file (e.g. <code>.ts</code>, <code>.js</code>,
                <code>.py</code>).
              </li>
              <li>
                Click inside (or select) a function, class or block of code –
                not just the very top or bottom of the file.
              </li>
              <li>
                Watch symbols appear here. Drag any card onto the board to
                create it.
              </li>
            </ol>
          </div>
          <div class="cs1 ce12">
            <p>
              AppExplorer cards are for pinning code references to a board,
              where you can add more context. Add screenshots, shapes with
              explanations, and draw lines connecting related code. You can
              explain how things are connected with as much or as little detail
              as you need.
            </p>
            <app-card
              .miroDraggable=${false}
              .cardData=${{
                title: "{title} - Example Card",
                boardId: "",
                type: "symbol",
                path: "{file/path}",
                symbol: "{symbol/path}",
                codeLink: "https://github.com/AsaAyers/AppExplorer",
                status: "disabled",
              } satisfies CardData}
            ></app-card>
            <p>
              You can customize the title of the card, it defaults to the symbol
              path. When the card is created and updated, it stores a permalink
              using the current commit hash.
            </p>

            <ul class="onboarding-faq">
              <li>
                <strong>What is a symbol?</strong>
                AppExplorer works with any language by working with the language
                server. Different languages will have different rules about what
                makes a symbol. In JavaScript a symbol is any variable or
                function declaration. Function callbacks are symbols that often
                don't have a name.
              </li>
              <li>
                <strong>What does "around the cursor" mean?</strong>
                Symbols are nested, so a class might have a method that has a
                <code>.map(callback)</code> that declares a variable. If your
                cursor is inside the variable declaration, you will see all of
                those levels. If you move the cursor o the class constructor,
                you still have that base symbol, but now you have
                "YourClass/constructor".
              </li>
              <li>
                <strong>Why are there no symbols around my cursor?</strong>
                You might be at the top of the file where there are imports.
                While imports do pull symbols into the local scope, they are not
                declaring symbols, so are not able to be AppExplorer cards.
              </li>
              <li>
                <strong
                  >What if my file is huge? Will I have too many cards to choose
                  from?</strong
                >
                VSCode is already managing the symbols. You can see them with
                "Explorer: Focus on Outline View". AppExplorer is subscribed to
                updates, so that when your cursor moves, we only grab the slice
                of symbols around your cursor. If you do have files that are
                very deeply nested, then the sidebar will just scroll however
                many levels you have available. They're sorted closest symbol at
                the top, so I think that's usually the card you want to use.
              </li>
            </ul>
          </div>
        </div>
      </div>
    `;
  }
}
