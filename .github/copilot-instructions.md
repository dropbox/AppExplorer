# Copilot Instructions for AppExplorer

## Overview

AppExplorer is a VSCode extension designed to integrate Miro boards with VSCode, enabling developers to link code to Miro cards and navigate seamlessly between them. The extension also hosts a local webserver for communication with Miro.

### Key Components

1. **VSCode Extension**:

   - Entry point: `src/extension.ts`.
   - Registers commands like `app-explorer.createCard`, `app-explorer.attachCard`, and `app-explorer.navigate`.
   - Manages VSCode's behavior and talks to the Local Webserver over websockets.

2. **Local Webserver**:

   - Implemented in `src/server.ts`.
   - Hosts a webserver on `http://localhost:9042/`.
   - Uses `socket.io` for real-time communication.
   - It is launched inside the first workspace to open. Even the hosting workspace communicates over websockets.
   - It does not persist any data, it just holds data about the Miro boards you're connected to and routes events back and forth.
   - If you close the hosting workspace, the webserver shuts down with it. Any workspaces still open will see the disconnect event and will start their own webserver.
   - The OS only allows 1 process to hold a port, so that works to make sure there can only be one winner and all workspaces reconnect to it.
   - The endpoint `http://localhost:9042/storage` provides a raw JSON view of `cardsByBoard`, a `Record<Card['boardId'], CardData[]>`. This can be useful for debugging, such as verifying connected boards and cards when issues arise.

3. **Miro Integration**:

   - Core logic in `src/miro.ts`.
   - Handles Miro board operations such as creating/updating cards and zooming into cards.
   - Relies on the Miro Web SDK.
   - Talks to the Local Webserver over websockets.
   - This loads in a 0x0 iframe in the Miro board. The SDK talks to the board and provides events.

4. **Frontend**:
   - Static assets in `public/` (e.g., `index.html`, `index.css`).
   - Provides the UI for the Miro extension.

### Data Flow

- **VSCode Workspace**: Triggered by users to perform actions like creating cards or navigating to code.
- **Miro Server**: Relays data between VSCode and Miro boards.
- **Miro SDK**: Executes board-specific operations. It can also send commands back to the VSCode Workspace.

## Developer Workflows

### Building the Extension

1. Clone the repository:
   ```bash
   git clone git@github.com:dropbox/AppExplorer.git
   cd AppExplorer
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the extension:
   ```bash
   npm run compile
   ```
4. Package and install the extension:
   ```bash
   rm *.vsix; vsce pack; code --install-extension app-explorer-*.vsix
   ```

### Running the Webserver

- The webserver starts automatically when the extension is activated.
- Access it at `http://localhost:9042/`.
- `http://localhost:9042/storage` shows all the data the server is currently holding about attached Miro boards.

### Testing

- Run tests with:
  ```bash
  # pretest will compile everything
  npm test
  ```
- Watch tests during development:
  ```bash
  npm run watch-tests
  ```

There is a `setup-xvfb.sh` script for setting up a virtual framebuffer. This is essential in all scenarios except human debugging. It is helpful for running headless tests, especially when the computer is in use and window pop-ups would be disruptive. Source it into the current shell at the start of a session; it only needs to be run once.

## Project-Specific Conventions

- **Card Metadata**: Cards in Miro are linked to code using metadata (`path`, `symbol`, `codeLink`). See `updateCard` in `src/miro.ts`.
- **Socket Communication**: Real-time updates between Miro and VSCode use `socket.io`. Queries and responses are defined in `EventTypes.ts`.
  - Example Workspace Event: `navigateToCode` - Sent when navigating from a Miro card to the corresponding code.
  - Example Miro Event: `navigateToCard` - Sent when navigating from code to the corresponding Miro card.
- **Commands**: All user-facing actions are registered as VSCode commands in `src/extension.ts`.

  - Commands are created in their own files.
  - Example Command Structure:

    ```typescript
    export const makeNewCardHandler = (context: HandlerContext) =>
      async function (options: CreateCardOptions = {}) {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          const uri = getRelativePath(editor.document.uri);
          if (!uri) {
            return;
          }
          await context.waitForConnections();

          const boardId = await selectConnectedBoard(context);
          if (boardId) {
            const cardData = await makeCardData(editor, boardId, {
              canPickMany: false,
            });
            if (cardData) {
              await promiseEmit(
                context.cardStorage.socket,
                "newCards",
                boardId,
                cardData,
                {
                  connect: options.connect,
                },
              );
            }
            return cardData;
          }
        }
        return [];
      };
    ```

## Integration Points

- **Miro SDK**: Used extensively in `src/miro.ts` for board operations.
- **Socket.IO**: Facilitates communication between the local server and Miro.
- **Language Server Protocol**: Powers code navigation and symbol resolution.

## Key Files and Directories

- `src/extension.ts`: Main entry point for the VSCode extension.
- `src/miro.ts`: Handles Miro board interactions.
- `src/server.ts`: Implements the local webserver.
- `public/`: Contains static assets for the Miro extension.
- `test/`: Contains test cases for the extension.

## Notes

- The extension is designed to work with any language supported by VSCode's LSP.
- Ensure the Miro SDK is accessible via the hosted webserver.
- Use the [Public AppExplorer Board](https://miro.com/app/board/uXjVL0VAGdA=/?share_link_id=273783644676) for reference diagrams.

## Testing Focus

- End-to-end tests are the primary focus. While there are robust tests for single workspace flows, a strategy for testing a workspace joining an existing server is still under development.

## Logging

- All logging uses the `debug` library.
  - During tests, logs are output to the console.
  - In the workspace, logs are directed to an `OutputChannel` for better integration with VSCode.
  - Log namespaces follow the pattern `app-explorer:*`, matching the kebab-case version of the filename (e.g., `app-explorer:create-card`). Additional namespaces may be added as needed.
