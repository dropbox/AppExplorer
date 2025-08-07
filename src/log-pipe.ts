import { spawn } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as net from "net";
import * as path from "path";
import * as readline from "readline";
import invariant from "tiny-invariant";
import { checkpointRegex } from "./utils/log-checkpoint";

type ReaderDisposer = {
  dispose: () => void;
};

export class LogPipe {
  private folder: string;
  private filename: string;
  private isWindows: boolean = process.platform === "win32";

  // Unix-specific
  private pipePath?: string;
  private unixWriterHandle?: fs.promises.FileHandle;
  private unixReaderRl?: readline.Interface;

  // Windows-specific
  private pipeName?: string; // \\.\pipe\...
  private winServer?: net.Server;
  private winWriterSocket?: net.Socket;
  private winReaderSockets: Set<net.Socket> = new Set();
  private winWriterConnected: Promise<void> | null = null;

  // Central teardown
  private subscriptions: (() => void)[] = [];
  private disposed = false;

  // multiplex readers
  private readers: Set<(line: string) => void> = new Set();
  private unixReaderCleanup?: () => void;
  private winReaderCleanup?: () => void;

  constructor(folder: string, filename: string) {
    this.folder = folder;
    this.filename = filename;

    if (this.isWindows) {
      const hash = crypto
        .createHash("sha256")
        .update(path.resolve(folder) + "|" + filename)
        .digest("hex")
        .slice(0, 16);
      this.pipeName = `\\\\.\\pipe\\logpipe-${hash}`;
    } else {
      this.pipePath = path.join(folder, filename);
    }
  }

  private async ensureUnixPipe(mode: "read" | "write"): Promise<void> {
    invariant(this.pipePath, "pipePath must be set on Unix");
    await fs.promises.mkdir(path.dirname(this.pipePath), { recursive: true });

    try {
      await fs.promises.stat(this.pipePath);
      // existing; assume acceptable
    } catch (err: unknown) {
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        err.code === "ENOENT"
      ) {
        await new Promise<void>((res, rej) => {
          const mk = spawn("mkfifo", ["-m", "600", this.pipePath!]);
          mk.on("exit", (code) => {
            if (code === 0) {
              res();
            } else {
              rej(new Error(`[${mode}] mkfifo exited with ${code}`));
            }
          });
          mk.on("error", (e) => rej(e));
        });
      } else {
        throw err;
      }
    }
  }

  private async initUnixWriter(): Promise<void> {
    if (this.unixWriterHandle) {
      return;
    }
    invariant(this.pipePath, "pipePath must be set for unix writer");
    await this.ensureUnixPipe("write");

    const openFlags = fs.constants.O_WRONLY | fs.constants.O_NONBLOCK;
    while (true) {
      try {
        const handle = await fs.promises.open(this.pipePath, openFlags);
        this.unixWriterHandle = handle;

        // teardown for writer handle
        this.subscriptions.push(async () => {
          try {
            await handle.close();
          } catch {}
          this.unixWriterHandle = undefined;
        });

        break;
      } catch (err: unknown) {
        if (
          err &&
          typeof err === "object" &&
          "code" in err &&
          (err.code === "ENXIO" || err.code === "EAGAIN")
        ) {
          await new Promise((r) => setTimeout(r, 100));
          continue;
        }
        throw err;
      }
    }
  }

  private async initWindowsWriter(): Promise<void> {
    invariant(this.pipeName, "pipeName must be set for windows writer");
    if (this.winWriterSocket) {
      return;
    }

    this.winWriterConnected = new Promise<void>((resolve) => {
      const tryConnect = () => {
        const sock = net.connect(this.pipeName!, () => {
          this.winWriterSocket = sock;

          // teardown
          this.subscriptions.push(() => {
            sock.end();
            this.winWriterSocket = undefined;
          });

          resolve();
        });
        sock.on("error", () => {
          setTimeout(tryConnect, 100);
        });
      };
      tryConnect();
    });
    await this.winWriterConnected;
  }

  /**
   * Returns a writer function that appends a line (with newline) into the pipe.
   */
  async getWriter(): Promise<(line: string) => Promise<void>> {
    invariant(!this.disposed, "LogPipe is disposed");
    if (this.isWindows) {
      await this.initWindowsWriter();
      return async (line: string) => {
        invariant(
          this.winWriterSocket,
          "Windows writer socket should be present",
        );
        return new Promise<void>((res, rej) => {
          this.winWriterSocket!.write(line /*+ os.EOL*/, (err) => {
            if (err) {
              rej(err);
            } else {
              res();
            }
          });
        });
      };
    } else {
      await this.initUnixWriter();
      return async (line: string) => {
        invariant(
          this.unixWriterHandle,
          "Unix writer handle should be initialized",
        );
        await this.unixWriterHandle.write(line /*+ "\n"*/);
      };
    }
  }

  /**
   * Attaches a reader that invokes callback for each full line. Returns a disposer to stop reading.
   */
  async getReader(callback: (line: string) => void): Promise<ReaderDisposer> {
    invariant(!this.disposed, "LogPipe is disposed");
    this.readers.add(callback);

    if (this.isWindows) {
      await this.initWindowsReader();
    } else {
      await this.initUnixReader();
    }

    return {
      dispose: () => {
        this.readers.delete(callback);
        if (this.readers.size === 0) {
          if (this.isWindows) {
            this.winReaderCleanup?.();
            this.winReaderCleanup = undefined;
          } else {
            this.unixReaderCleanup?.();
            this.unixReaderCleanup = undefined;
          }
        }
      },
    };
  }
  private async initUnixReader(): Promise<void> {
    invariant(this.pipePath, "pipePath must be set for unix reader");
    if (this.unixReaderRl) {
      return;
    }
    await this.ensureUnixPipe("read");

    const stream = fs.createReadStream(this.pipePath, {
      encoding: "utf8",
      highWaterMark: 1024,
    });
    const rl = readline.createInterface({
      input: stream,
      terminal: false,
    });
    this.unixReaderRl = rl;

    const onLine = (line: string) => {
      for (const cb of this.readers) {
        try {
          cb(line);
        } catch {}
      }
    };
    rl.on("line", onLine);

    const onError = (err: unknown) => {
      // eslint-disable-next-line no-console
      console.error("Unix pipe reader error:", err);
    };
    rl.on("error", onError);

    const disposeReader = () => {
      rl.off("line", onLine);
      rl.off("error", onError);
      rl.close();
      stream.destroy();
      this.unixReaderRl = undefined;
    };

    this.subscriptions.push(disposeReader);
    this.unixReaderCleanup = disposeReader;
  }

  private async initWindowsReader(): Promise<void> {
    invariant(this.pipeName, "pipeName must be set for windows reader");

    if (!this.winServer) {
      this.winServer = net.createServer((socket) => {
        this.winReaderSockets.add(socket);
        let buffered = "";
        socket.setEncoding("utf8");

        const dataHandler = (chunk: string) => {
          buffered += chunk;
          let idx: number;
          while ((idx = buffered.indexOf("\n")) !== -1) {
            const line = buffered.slice(0, idx);
            buffered = buffered.slice(idx + 1);
            for (const cb of this.readers) {
              try {
                cb(line);
              } catch {}
            }
          }
        };
        socket.on("data", dataHandler);

        const cleanupSocket = () => {
          socket.off("data", dataHandler);
          this.winReaderSockets.delete(socket);
        };
        socket.on("close", cleanupSocket);
        socket.on("error", cleanupSocket);
      });

      await new Promise<void>((resolve, reject) => {
        this.winServer!.listen(this.pipeName!, () => resolve());
        this.winServer!.on("error", (e) => reject(e));
      });

      const disposeServer = () => {
        for (const s of this.winReaderSockets) {
          s.destroy();
        }
        this.winServer?.close();
        this.winServer = undefined;
      };

      this.subscriptions.push(disposeServer);
      this.winReaderCleanup = disposeServer;
    }
  }

  /**
   * Capture logs starting after an optional precondition is met.
   */
  async capture(): Promise<{
    getCapturedLogs: () => string[];
    dispose: () => void;
  }> {
    const captured: string[] = [];
    const disposer = await this.getReader((line) => {
      if (line.match(checkpointRegex)) {
        captured.push(line);
      }
    });

    return {
      getCapturedLogs: () => [...captured],
      dispose: () => disposer.dispose(),
    };
  }

  /**
   * Dispose everything (readers, writers, servers, sockets, etc.)
   */
  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    // call all teardown subscriptions (some may be async)
    const subs = this.subscriptions.slice();
    this.subscriptions = [];
    await Promise.all(
      subs.map(async (fn) => {
        try {
          await fn();
        } catch {}
      }),
    );

    // extra safety cleanup
    if (this.unixReaderRl) {
      this.unixReaderRl.close();
      this.unixReaderRl = undefined;
    }
    if (this.winWriterSocket) {
      this.winWriterSocket.end();
      this.winWriterSocket = undefined;
    }
    if (this.winServer) {
      this.winServer.close();
      this.winServer = undefined;
    }
    this.winReaderSockets.clear();
    this.readers.clear();
    this.unixWriterHandle = undefined;
  }
}
