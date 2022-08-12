Development Board:

https://miro.com/app/board/uXjVOk9T9PU=/?share_link_id=883960100418

# App Explorer

This app uses the [Miro Web SDK][websdk] to diagram important landmarks in your
code, or other patterns you may want to scan for. It runs as a web server on
https://localhost:50505 and scans other projects on your machine.

To start the server run `npm install` then:

```
REPO_ROOT=/path/to/project npm run dev
REPO_ROOT=$PWD npm run dev
```

## Scanner: @AppExplorer and @TODO

This scanner uses ESLint to extract comments with @AppExplorer or @TODO tags to put on the Miro board.

## Scanner: React components

There is also a scanner that directly uses `typescript` to scan a module. It looks for exports, tries to identify components, and finds any JSX tags that are referenced in those components.

```
class Example extends React.Component {
  /**
   * If this returns JSX, it's getting marked as a component and put on the
   * board.
   */
  renderModal() {}
  render() {
    return <div>{this.renderModal()}<div>
  }
}
```

[websdk]: https://developers.miro.com/docs/miro-web-sdk-introduction
