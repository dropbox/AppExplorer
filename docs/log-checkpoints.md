This project uses `@vscode/test-cli` to run tests. The tests run in Node@24, and
launch an instance of VSCode with AppExplorer. Use `npm test` to run the tests
with coverage. `npm install` sets up all dependencies except installing VSCode.
(tested on v1.103.0)

The test runner doesn't have a way to inspect editor decorations, lenses, or the
content of quick picks. This document will explain how I'm working around that
with `src/utils/log-checkpoint.ts`.

I found it challenging to debug what was happening during some tests, because
the logs were going to either the Developer Tools' console, or a
`vscode.OutputChannel`. `Output` is one of the panels, mine is next to
`Terminal`. Both of those go away when the window closes at the end of the
test. Logs are all handled through the npm library `debug@4`. When the VSCode
extension launches it directs the output to an OutputChannel. Tests can run a
command that uses a `LogPipe` to create and write to a named pipe that gets a
copy of everything going to the OutputChannel. `LogPipe` is intended to be an
abstraction for transporting logs, so its exact details are out of scope of this
document. We put 1 line of text in one end and 1 line comes out the other end.
This allows all the console output to be seen together. The tests' reader logs
each line with the `[LOG]` prefix.

`miro.ts` runs in the browser and it's `debug` just writes to the console. It's
not something that can be tested with the test framework. Instead, its mocked
with the `MockMiroClient` taking its place. While testing, instead of running a
real browser that connects to the server over a websocket, `MockMiroClient`
connects in its place. It can simulate selecting cards, deleting cards,
triggering navigatin, etc. It runs in the test process.

During tests there is no browser involved. Only the test runner and the
workspace, which are connected through a LogPipe.

```ts
import createDebug from "debug";

const debug = createDebug("app-explorer:module-name");
```

```bash
DEBUG="app-explorer:*" npm test
```

In order to assist testing, I have created a CHECKPOINT object that makes
strings in the form of `{name:value}` that get written to the log. It's
important that this object either contains exact strings, or functions that will
make the string. The test runner is going to log everything it finds matching
`{${keyof CHECKPOINT}:...}` using a regex.

```ts
type CheckpointValue = `${keyof typeof CHECKPOINT}:${string}`;

/**
 * This is a sample of the object to demonstrate the pattern.
 * Names should be written in camelCase. Every item is or returns a string
 * literal.
 **/
const CHECKPOINT = {
  quickPick<T extends string>(title: T): `{quickPick:${T}}` {
    return `{quickPick:${title}}`;
  },
  createCard: "{createCard:start}",
} satisfies Record<
  string,
  ((...args: unknown[]) => CheckpointValue) | CheckpointValue
>;

export const checkpointRegex = new RegExp(
  `{(${Object.keys(CHECKPOINT).join("|")}):([^}]+)}`,
  "g",
);
```

There is a `waitForLog` helper that works with `CHECKPOINT` to find specific
logs. Its built on `waitForValue`, which has a configurable timeout before it
throws. This is why the CHECKPOINT functions don't write to the log, but instead
return a string to be written to the log. Because sometimes its used to match a
log.

```ts
// quickPick returns a template literal, so TypeScript can expand this to know
// exactly the 2 strings that this can return.
const boardOrSymbol = await waitForLog([
  CHECKPOINT.quickPick("Choose a board"),
  CHECKPOINT.quickPick("Choose a symbol step 1/2"),
]);

export async function waitForLog<T extends string>(
  predicate: T[],
  options?: Options,
): Promise<T>;
```

The test framework automatically launches VSCode with the extension setup and
pointed at the sample workspace in the repo. (End-to-end)
`E2ETestUtils.setupWorkspace` calls `app-explorer.internal.logFile` to get this
run's filename. It is run as part of the setup process in tests. The workspace
is only launched once, so the write side is not torn down between tests. Each
reader should simply `dispose()` of the LogCapture at the end of the test.
Because tests share the workspace they cannot run in parallel, so there is no
cross-test leakage of logs.

- Every time a quickPick is launched has a `debug(CHECKPOINT.quickPick(...))`.
- Every quickPick has an `onDidSelectItem` that logs `CHECKPOINT.selected(item)`.
- The create card process logs `CHECKPOINT.createCard`
