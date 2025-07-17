---
type: "always_apply"
---

# Copilot Instructions for AppExplorer

## Overview

AppExplorer is a VSCode extension designed to assist developers in creating architecture diagrams using Miro boards. It integrates with VSCode's Language Server Protocol (LSP) to link code to Miro cards, enabling seamless navigation between code and diagrams. The extension also hosts a local webserver to facilitate communication with Miro.

### Key Components

1. **VSCode Extension**:

   - Located in `src/extension.ts`.
   - Registers commands like `app-explorer.createCard`, `app-explorer.attachCard`, and `app-explorer.navigate`.
   - Manages interactions between VSCode and the Miro server.

2. **Miro Integration**:

   - Core logic in `src/miro.ts`.
   - Handles Miro board interactions, such as creating and updating cards, tagging, and zooming into cards.
   - Uses the Miro Web SDK for board operations.

3. **Local Webserver**:

   - Implemented in `src/server.ts`.
   - Hosts a webserver on `http://localhost:9042/` to act as a Miro extension.
   - Uses `socket.io` for real-time communication between Miro and VSCode.

4. **Frontend**:
   - Static assets in `public/` (e.g., `index.html`, `index.css`).
   - Provides the UI for the Miro extension.

### Data Flow

- **VSCode Commands**: Triggered by the user to perform actions like creating cards or navigating to code.
- **Miro Server**: Relays data between VSCode and Miro boards.
- **Miro SDK**: Executes board-specific operations (e.g., creating cards, updating metadata).

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

### Testing

- Run tests with:
  ```bash
  npm test
  ```
- Watch tests during development:
  ```bash
  npm run watch-tests
  ```

## Project-Specific Conventions

- **Card Metadata**: Cards in Miro are linked to code using metadata (`path`, `symbol`, `codeLink`). See `updateCard` in `src/miro.ts`.
- **Socket Communication**: Real-time updates between Miro and VSCode use `socket.io`. Queries and responses are defined in `EventTypes.ts`.
- **Commands**: All user-facing actions are registered as VSCode commands in `src/extension.ts`.

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
