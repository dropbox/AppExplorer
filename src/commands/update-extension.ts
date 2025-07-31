import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

let outputChannel: vscode.OutputChannel;

export function registerUpdateCommand(context: vscode.ExtensionContext) {
  let disposable = vscode.commands.registerCommand(
    "app-explorer.updateExtension",
    async () => {
      outputChannel ??= vscode.window.createOutputChannel("AppExplorer Update");
      try {
        outputChannel.clear();
        outputChannel.show(true); // Focus the output channel

        const updateWorkspacePath = context.workspaceState.get<string>(
          "updateWorkspacePath",
        );
        if (!updateWorkspacePath) {
          vscode.window.showErrorMessage(
            "No workspace folder found for update.",
          );
          return;
        }

        const vscePath = findVsceExecutable(updateWorkspacePath);
        if (!vscePath) {
          vscode.window.showErrorMessage(
            "vsce not found. Please ensure it is installed and in your PATH.",
          );
          return;
        }

        outputChannel.appendLine(`Using vsce from: ${vscePath}`);
        outputChannel.appendLine(
          `Packing extension in: ${updateWorkspacePath}`,
        );

        const packProcess = childProcess.spawn(vscePath, ["pack"], {
          cwd: updateWorkspacePath,
          shell: true,
        });

        packProcess.stdout.on("data", (data) => {
          outputChannel.append(data.toString());
        });

        packProcess.stderr.on("data", (data) => {
          outputChannel.append(data.toString());
        });

        packProcess.on("close", (code) => {
          if (code !== 0) {
            outputChannel.appendLine(`vsce pack failed with code: ${code}`);
            vscode.window.showErrorMessage(
              `vsce pack failed. See AppExplorer Update output.`,
            );
            return;
          }

          outputChannel.appendLine("vsce pack completed successfully.");

          // 2. Find the generated VSIX file
          vscode.workspace.findFiles("*.vsix").then((vsixFiles) => {
            if (vsixFiles.length === 0) {
              vscode.window.showErrorMessage(
                "No VSIX file found after packing.",
              );
              return;
            }
            const vsixFileUri = vsixFiles[0]; // Assuming only one VSIX file

            // 3. Install from VSIX
            vscode.commands
              .executeCommand(
                "workbench.extensions.installExtension",
                vsixFileUri,
              )
              .then(() => {
                outputChannel.appendLine(
                  "Extension installed successfully. Reloading window...",
                );
                // 4. Reload Window
                vscode.commands.executeCommand("workbench.action.reloadWindow");
              });
          });
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (error: any) {
        outputChannel.appendLine(`Extension update failed: ${error.message}`);
        vscode.window.showErrorMessage(
          `Extension update failed: ${error.message}`,
        );
      }
    },
  );

  context.subscriptions.push(disposable);
}

function findVsceExecutable(rootPath: string): string | undefined {
  // Check if vsce is in the PATH
  let binary = process.platform === "win32" ? "vsce.cmd" : "vsce";
  console.log("vsce binary", binary, process.platform);
  try {
    const version = childProcess.spawnSync(binary, ["--version"], {
      cwd: rootPath,
      encoding: "utf8",
      shell: true,
    });
    if (version.status !== 0) {
      throw new Error(`vsce not found in PATH. Status: ${version.status}`);
    }
    return "vsce";
  } catch (error) {
    const nodeModulesVsce = path.join(rootPath, "node_modules", ".bin", binary);
    if (fs.existsSync(nodeModulesVsce)) {
      try {
        const version = childProcess.spawnSync(nodeModulesVsce, ["--version"], {
          cwd: rootPath,
          encoding: "utf8",
          shell: true,
        });
        console.log(nodeModulesVsce, "version", version);
        if (version.status === 0) {
          return nodeModulesVsce;
        }
      } catch (e) {
        console.log("vsce error", e);
        // Ignore errors
      }
    }
    return undefined;
  }
}
