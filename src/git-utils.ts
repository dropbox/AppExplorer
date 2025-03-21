import * as util from "util";
import * as childProcess from "child_process";
const exec = util.promisify(childProcess.exec);

export interface GitUtils {
  getCurrentHash(cwd: string): Promise<string | null>;
  getRemotes(cwd: string): Promise<string[]>;
  getRemoteUrl(remoteName: string, cwd: string): Promise<string | null>;
}

export class DefaultGitUtils implements GitUtils {
  public async getCurrentHash(cwd: string): Promise<string | null> {
    try {
      const { stdout } = await exec("git rev-parse HEAD", { cwd });
      return stdout.trim();
    } catch {
      return null;
    }
  }

  public async getRemotes(cwd: string): Promise<string[]> {
    try {
      const { stdout } = await exec("git remote", { cwd });
      return stdout.trim().split("\n");
    } catch {
      return [];
    }
  }

  public async getRemoteUrl(
    remoteName: string,
    cwd: string,
  ): Promise<string | null> {
    try {
      const { stdout } = await exec(
        `git config --get remote.${remoteName}.url`,
        { cwd },
      );
      return stdout.trim();
    } catch {
      return null;
    }
  }
}
