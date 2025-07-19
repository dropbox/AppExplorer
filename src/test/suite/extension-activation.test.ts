import * as assert from "assert";
import * as vscode from "vscode";

/**
 * Test to verify VSCode extension activation and coverage measurement
 */
suite("Extension Activation Tests", () => {
  test("Extension can be activated", async function () {
    this.timeout(30000);

    console.log("Testing extension activation...");

    // Get the extension
    const extension = vscode.extensions.getExtension("dropbox.app-explorer");
    console.log("Extension found:", !!extension);
    console.log("Extension active:", extension?.isActive);

    if (extension && !extension.isActive) {
      console.log("Activating extension...");
      const result = await extension.activate();
      console.log("Extension activation result:", result);
      console.log("Extension now active:", extension.isActive);
    }

    // Verify extension is active
    assert.ok(extension, "Extension should be found");
    assert.ok(extension?.isActive, "Extension should be active");

    // Test if commands are registered
    const commands = await vscode.commands.getCommands();
    const appExplorerCommands = commands.filter((cmd) =>
      cmd.startsWith("app-explorer."),
    );
    console.log("AppExplorer commands found:", appExplorerCommands.length);
    console.log("Commands:", appExplorerCommands);

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

    console.log("Extension activation test completed successfully");
  });

  test("Extension context is available", async function () {
    this.timeout(15000);

    // Ensure extension is activated
    const extension = vscode.extensions.getExtension("dropbox.app-explorer");
    if (extension && !extension.isActive) {
      await extension.activate();
    }

    // Test context variables
    const appExplorerEnabled = await vscode.commands.executeCommand(
      "getContext",
      "appExplorer.enabled",
    );

    console.log("AppExplorer enabled context:", appExplorerEnabled);

    // The context should be set during activation
    assert.ok(appExplorerEnabled, "AppExplorer should be enabled in context");
  });
});
