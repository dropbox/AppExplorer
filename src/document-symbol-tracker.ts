import createDebug from "debug";
import * as vscode from "vscode";
import { SymbolAnchor } from "./commands/create-card";
import { CardData } from "./EventTypes";
import { getGitHubUrl } from "./get-github-url";
import { getRelativePath } from "./get-relative-path";
import { LocationFinder } from "./location-finder";

const debug = createDebug("app-explorer:document-symbol-tracker");

/**
 * Shape of the event payload when the symbol path under the cursor changes.
 * labels are guaranteed unique (LocationFinder flattens & constructs unique names).
 */
export interface SymbolPathChangeEvent {
  type: "symbolsChanged";
  uri: vscode.Uri;
  version: number; // TextDocument version at sampling time
  symbols: CardData[]; // Same order as labels
}

interface SymbolRequest {
  type: "symbolRequest";
}

type SymbolEvents = SymbolPathChangeEvent | SymbolRequest;

/**
 * Tracks the chain of symbols enclosing the active editor's primary cursor.
 * Emits a SymbolPathChangeEvent when that chain changes (by content edits or cursor moves).
 * Uses LocationFinder.findSymbolsAroundCursor which already returns flattened, unique labels.
 */
export class DocumentSymbolTracker
  extends vscode.EventEmitter<SymbolEvents>
  implements vscode.Disposable
{
  private finder: LocationFinder;
  private disposables: vscode.Disposable[] = [];
  private debounceTimer: NodeJS.Timeout | null = null;
  private lastPathKey: string | null = null;
  private lastUriString: string | null = null;
  private debounceMs: number;
  constructor(finder: LocationFinder, debounceMs = 400) {
    super();
    this.debounceMs = debounceMs;
    this.finder = finder;

    this.event((e) => {
      if (e.type === "symbolRequest") {
        this.refresh(true); // force refresh on request
      }
    });

    // Text changes (could alter symbol structure / ranges)
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document === vscode.window.activeTextEditor?.document) {
          this.schedule();
        }
      }),
    );
    // Cursor / selection movements (symbol path can change without edits)
    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection((e) => {
        if (e.textEditor === vscode.window.activeTextEditor) {
          this.schedule(true); // something
        }
      }),
    );
    // Active editor changed
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.schedule()),
    );
    // Opened doc (useful if LS warm-up completes only after open)
    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((doc) => {
        if (doc === vscode.window.activeTextEditor?.document) {
          this.schedule();
        }
      }),
    );
  }

  /** Force immediate refresh (ignores debounce). */
  public async forceRefresh() {
    await this.refresh();
  }

  private schedule(fast = false) {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    const delay = fast ? Math.min(120, this.debounceMs / 3) : this.debounceMs;
    this.debounceTimer = setTimeout(() => this.refresh(), delay);
  }

  private async refresh(force = false) {
    this.debounceTimer = null;
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      this.maybeEmit([], null, null, force);
      return;
    }
    const doc = editor.document;
    const position = editor.selection.active;
    try {
      const symbols = await this.finder.findSymbolsAroundCursor(
        doc.uri,
        position,
      );
      this.maybeEmit(symbols, doc.uri, doc.version, force);
    } catch (err) {
      debug("symbol refresh error", err);
    }
  }

  private async maybeEmit(
    symbols: SymbolAnchor[],
    uri: vscode.Uri | null,
    version: number | null,
    force: boolean,
  ) {
    const labels = symbols.map((s) => s.label).reverse(); // ensure outer->inner order
    const pathKey = labels.join("→");
    const uriString = uri?.toString() ?? "";
    const changed =
      pathKey !== this.lastPathKey || uriString !== this.lastUriString;
    if (!changed && !force) {
      return;
    }
    this.lastPathKey = pathKey;
    this.lastUriString = uriString;

    const boardId = "";
    const cards = await Promise.all(
      symbols.map(async (anchor): Promise<CardData> => {
        const def: vscode.LocationLink = {
          targetUri: anchor.uri,
          targetRange: anchor.range,
        };
        const path = getRelativePath(def.targetUri)!;
        return {
          type: "symbol",
          boardId,
          title: anchor.label,
          path,
          symbol: anchor.label,
          codeLink: await getGitHubUrl(def),
          status: "connected",
        };
      }),
    );

    if (uri) {
      debug("symbol path change", { pathKey });
      this.fire({
        type: "symbolsChanged",
        uri,
        version: version ?? -1,
        symbols: cards,
      });
    }
  }

  dispose() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}

// Convenience: singleton instance
let singleton: DocumentSymbolTracker | null = null;
export function getDocumentSymbolTracker(
  locationFinder: LocationFinder,
): DocumentSymbolTracker {
  if (!singleton) {
    singleton = new DocumentSymbolTracker(locationFinder);
  }
  return singleton;
}
