# AppExplorer

This is the AppExplorer VSCode extension that helps create documentation hosted in Miro.

## Features

`AppExplorer: Create Card`

- Identifies the symbol under the cursor
- Locates where it's defined and attaches a card to it

`AppExplorer: Attach Card to Code`

- Attaches the currently selected card to a symbol in the code

## Requirements

This extension requires Miro and to enable the [AppExplorer](https://miro.com/oauth/authorize/?response_type=code&client_id=3458764531189693223&redirect_uri=%2Fconfirm-app-install%2F) addon.

Download the latest `app-explorer-*.vsix` from
https://github.com/dropbox/AppExplorer/tags. I'm not distributing it in the
VSCode market because it's only useful with Miro, with that Miro added
installed. I've already gone through the process to get it approved withing
Dropbox

```
# This assumes you only have 1 version downloaded
code --install-extension app-explorer-*.vsix
```

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
rm *.vsix; vsce pack; code --install-extension app-explorer-*.vsix
```

1. Rebuild and install
2. Refresh Miro
3. Refresh VSCode

If you don't refresh Miro, you can get a mix of old `/public/miro.js` code along
with newer changes in `src`.

## Known Issues

- The project is very incomplete at this stage

## Release Notes

- 0.0.6 - Code Navigation
  - Selecting a single card in Miro will bring you to the code
  - Clicking `App Explorer (# cards)` on the status bar lets you QuickPick a card
    - Miro will move to show yoy the cards as you search
    - Choosing a card will select it in Miro
      - Selecting the card will also navigate to the code.
  - All cards on the board use Miro's native linking feature for permalinks.
  - If you have a card selected in miro, you can `AppExplorer: Attach Card to Code` to reattach it to a symbol you're looking at.
- 0.0.7 - AppCards
  - Up through version 0.0.6 I've been using Miro Cards that can be edited on the board. This makes it too easy to accidentally overwrite titles.
  - When selecting a card from an older version, it will be migrated to a new AppCard and then removed.
    - I couldn't get it to reliably place the new card over the old one, so it just puts it in the center of the viewport.
  - All new cards are AppCards
- 0.1.0 - Improved Navigation

  - This version uses Miro's normal `app_card:open` event (round button in the
    top-right corner of the card) to navigate. The previous version was navigating
    when you select a single card.
  - ![image](https://github.com/dropbox/AppExplorer/assets/324999/217b86f3-c026-4567-adf9-4b0b5d84b52a)

- Tag Selected Cards
  - Create or remove Miro tags on AppCards.
