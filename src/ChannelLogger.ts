import * as vscode from "vscode";

export class ChannelLogger {
  private channel: vscode.OutputChannel;
  constructor(private name: string) {
    this.channel = vscode.window.createOutputChannel(this.name);
    this.channel.clear();
    this.channel.show();
  }

  dispose() {
    this.channel.dispose();
  }

  log(...args: unknown[]) {
    this.channel.appendLine(
      args
        .map((arg) =>
          typeof arg === "string" ? arg : JSON.stringify(arg, undefined, 2),
        )
        .join(" "),
    );
  }
}
export const logger = new ChannelLogger("AppExplorer");
