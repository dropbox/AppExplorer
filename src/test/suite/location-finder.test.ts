import * as assert from "assert";
import * as vscode from "vscode";
import { LocationFinder } from "../../location-finder";
import { uriForFile, waitFor } from "./test-utils";

suite("LocationFinder", () => {
  let locationFinder: LocationFinder;
  let exampleUri: vscode.Uri;

  suiteSetup(() => {
    locationFinder = new LocationFinder();
    exampleUri = uriForFile("example.ts");
  });

  test("finds symbols in document", async () => {
    const symbols = await waitFor(async () => {
      const symbols = await locationFinder.findSymbolsInDocument(exampleUri);
      assert.ok(symbols.length > 0, "No symbols found");
      return symbols;
    });
    assert.ok(symbols.some((s) => s.label === "TestClass"));
  });

  test("finds symbol at position", async () => {
    const document = await vscode.workspace.openTextDocument(exampleUri);
    const position = new vscode.Position(1, 15); // Inside TestClass constructor

    const symbol = await waitFor(async () => {
      const symbol = await locationFinder.findSymbolInPosition(
        document.uri,
        position,
      );
      assert.ok(symbol, "No symbol found at the specified position");
      return symbol;
    });
    assert.strictEqual(symbol.label, "TestClass/constructor");
  });
});
