# AppExplorer

AppExplorer is a tool for creating detailed internal architecture diagrams that
are linked to the code they represent. It is designed to help team leads and
lead developers create accurate and easy-to-understand diagrams that simplify
the complexity of their codebase while maintaining a stable and reliable
connection to the underlying code.

AppExplorer integrates with VSCode, allowing developers to create cards linked
to specific sections of code based on file paths and symbol names. These cards
can also be used to navigate VSCode, making it easy to update the links as the
codebase evolves.

When you open a card and its target symbol has been renamed, you'll land in the
same file, but the card may become disconnected. However, AppExplorer provides
an "Attach Card to Code" command that allows you to re-attach the card to the
new symbol name or location, ensuring that the diagram remains accurate and
up-to-date.

The cards created by AppExplorer link to GitHub, providing a stable anchor that
can help developers quickly navigate to the code that needs to be changed. By
maintaining this connection between the diagrams and the codebase, AppExplorer
ensures that the documentation remains accurate and reliable, even as the
codebase evolves.

If you're interested in contributing to the project, AppExplorer's [Miro
board](https://miro.com/app/board/uXjVL0VAGdA=/?share_link_id=273783644676)
provides an onboarding resource that allows you to explore the codebase and
understand how it is structured. You can also suggest new features or
improvements to the tool, or help maintain and update the existing
documentation.

## Features

`AppExplorer: Create Card`

- Identifies the symbol under the cursor
- Locates where it's defined and attaches a card to it

`AppExplorer: Attach Card to Code`

- Attaches the currently selected card to a symbol in the code

## Requirements

This extension requires Miro and to enable the [AppExplorer](https://miro.com/oauth/authorize/?response_type=code&client_id=3458764531189693223&redirect_uri=%2Fconfirm-app-install%2F) addon.

## Contributing

If you want to work directly on AppExplorer you need to globally install
@vscode/vsce.

```
npm install -g @vscode/vsce
```

This extension operates by opening a webserver on http://localhost:50505/. This
is the URL that the Miro extension will load in the background to connect with
VSCode. The code in the `/public` folder is NOT configured to run through a
transpiler, so it's JavaScript with TypeScript/DocBlock annotations. It's better
than nothing, but it doesn't provide the safety of a real TypeScript file.

If you open the project and press F5 or run the command `Debug: Start Debugging`, it will launch a temporary VSCode running the extension. I don't think this process accounts for the `/public` folder though.

I'll usually just build and reinstall with this:

```
git pull main
npm install -g @vscode/vsce   # On first install
npm install                   # after updates

# Remove any built extensions, build a new copy, and install it.
rm *.vsix; vsce pack && code --install-extension app-explorer-*.vsix
```

1. Rebuild and install
2. Refresh Miro
3. Refresh VSCode

If you don't refresh Miro, you can get a mix of old `/public/miro.js` code along
with newer changes in `src`.

## Release Notes

- Its best to just build from `main` at this point.
