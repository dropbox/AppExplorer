import { CSSResultGroup, CSSResultOrNative, LitElement } from "lit";

const styleMap = new WeakMap<CSSResultOrNative, CSSStyleSheet | undefined>();

/**
 * The Miro WebSDK can't drag if I'm using the shadow DOM. So this avoids that
 * issue and attaches the styles globally.
 */
export class AppElement extends LitElement {
  constructor() {
    super();
  }

  protected static finalizeStyles(
    styles?: CSSResultGroup,
  ): Array<CSSResultOrNative> {
    const v = super.finalizeStyles(styles);
    v.forEach((s) => {
      if (!styleMap.has(s)) {
        const stylesheet = s instanceof CSSStyleSheet ? s : s.styleSheet;
        styleMap.set(s, stylesheet);
        // Attach the stylesheet to the document
        if (stylesheet && !document.adoptedStyleSheets.includes(stylesheet)) {
          document.adoptedStyleSheets.push(stylesheet);
        }
      }
    });
    return v;
  }

  protected createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }
}
