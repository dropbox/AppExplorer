import * as assert from "assert";
import * as vscode from "vscode";
import { createDebug } from "../../utils/create-debug";
const debug = createDebug("app-explorer:test:extension-activation");

/**
 * Test to verify VSCode extension activation and coverage measurement
 */
suite("Extension Activation Tests", () => {
  test("Extension can be activated", async function () {
    this.timeout(30000);

    debug("Testing extension activation...");

    // Get the extension
    const extension = vscode.extensions.getExtension("dropbox.app-explorer");
    debug("Extension found:", !!extension);
    debug("Extension active:", extension?.isActive);

    if (extension && !extension.isActive) {
      debug("Activating extension...");
      const result = await extension.activate();
      debug("Extension activation result:", result);
      debug("Extension now active:", extension.isActive);
    }

    // Verify extension is active
    assert.ok(extension, "Extension should be found");
    assert.ok(extension?.isActive, "Extension should be active");

    // Test if commands are registered
    const commands = await vscode.commands.getCommands();
    const appExplorerCommands = commands.filter((cmd) =>
      cmd.startsWith("app-explorer."),
    );
    debug("AppExplorer commands found:", appExplorerCommands.length);
    debug("Commands:", appExplorerCommands);

    // Verify key commands are registered
    const expectedCommands = [
      "app-explorer.createCard",
      "app-explorer.attachCard",
      "app-explorer.navigate",
      "app-explorer.browseCards",
    ];

    for (const expectedCommand of expectedCommands) {
      assert.ok(
        appExplorerCommands.includes(expectedCommand),
        `Command ${expectedCommand} should be registered`,
      );
    }

    debug("Extension activation test completed successfully");
  });

  test("Extension context is available", async function () {
    this.timeout(15000);

    // Ensure extension is activated
    const extension = vscode.extensions.getExtension("dropbox.app-explorer");
    if (extension && !extension.isActive) {
      await extension.activate();
    }

    // Test that the extension activated successfully and returned the expected result
    assert.ok(extension, "Extension should be found");
    assert.ok(extension?.isActive, "Extension should be active");

    // Check that the activation result contains the expected properties
    const activationResult = extension?.exports;
    debug("Extension activation result:", activationResult);

    // The extension should return an object with appExplorer: true
    assert.ok(activationResult, "Extension should return activation result");
    assert.strictEqual(
      activationResult.appExplorer,
      true,
      "AppExplorer should be enabled",
    );
  });
});
