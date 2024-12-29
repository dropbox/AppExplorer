# AppExplorer

[Public AppExplorer board](https://miro.com/app/board/uXjVL0VAGdA=/?share_link_id=273783644676)

**The primary output of AppExplorer is architecture diagrams.**

These diagrams can be exported as images from Miro and integrated into standard
documentation tools, serving as long-term references for the codebase. While
Miro provides a dynamic and collaborative space for team members actively
working on the code, the exported diagrams ensure the documentation remains
accessible and useful for broader audiences, including stakeholders not directly
involved in development.

## What problem does this solve?

AppExplorer assists in making archetecture diagrams of your code using Miro as
an infinite whiteboard. It doesn't automatically scan things, instead it allows
you to walk the codebase as you naturally would and attach the referenced code
to your Miro diagrams. It does this by creating AppExplorer cards in Miro that
also link to source control.

It sits on top of VSCode's Language Server support. So it works with any
language that you have a a language server for. These are usually installed as
VSCode extensions for languages that don't come with VSCode. The Outline view is
also powered by the same lanaguage server support. If the outline view is
empty, you may need to install an extension for the current language.

Diagrams may be as complex or as simple as you need. It is your job to decide
which abstractions you're going to jump over with a connection line and optional
explanation, and which pieces are you linking to and making a card for.

## Workflow - Planning

When planning a new project, you might want to use shapes instead of cards to
digram how the system should interact with the different pieces. Add any context
you need, like design images, notes, comments, etc.

As you build the different pieces, come back with AppExplorer and attach cards
near or replacing the shapes. Sometimes things didn't go exactly to plan, or you
have to take some shortcut that leaves some technical debt. This is a great
place to document that in as much detail as you'd like. It's an infinite
whiteboard, sometimes you need to just have a separate frame to explain a
concept instead of adding to some existing frame.

Toward the end of the project, the Miro board should have a lot of good
information. You may want to export each frame as an image and store it in your
knowledge management system with a link back to the frame. The link back is
important for future developers, so they can link to Miro and then link out to
source control.

## Workflow - Documenting legacy systems

When navigating around many similarly-named things, it can be hard to keep track
of everything. With legacy systems that have evolved over time, it's hard to get
a good high level overview of what's going on. By anchoring code to an
AppExplorer card on the board you can work through building up a diagram of the
existing code a piece at a time. This is also all developer-guided, so don't
just link to where "Go to Definition" would land you. Sometimes you want to
pretend that next layer doesn't exist, and go link to what's going to be
relevant to the future maintenance of the application.

## Tooling

AppExplorer is a VSCode Extension that leverages VSCode's Language Server
support. This is much easier than coding directly against language servers and
having to figure out exactly how to configure and launch each one.

This extension also hosts a webserver on http://localhost:50505/ that is a Miro
extension. Miro was chosen because it's the most flexible solution with the most
features. I could make diagrams with graphviz, but I lose the ability to
customize the layout. This tool is not a scanner, it's for leaving a trail as
you walk your codebase.

# Public AppExplorer Board

The best way to understand what AppExplorer does is to explore its output. I've
used AppExplorer on its own codebase to create the [Public AppExplorer
board](https://miro.com/app/board/uXjVL0VAGdA=/?share_link_id=273783644676). At
a high level, you can see how the frames connect to form a rough overview of the
system's conceptual parts. Zoom in to explore AppExplorer cards, which include
tags like `VSCode Extension` or `Miro`, and find additional context through shapes,
stickies, cards, and screenshots of VSCode.

At a high level, the concept here is to zoom in and out to whatever level is
comfortable and useful to you.

Who is this for and what should they get out of it?

- For project managers: Gain a high-level overview to identify opportunities for applying AppExplorer to future projects.
- For lead developers: Explore diagrams that inspire similar documentation for new or legacy projects.
- For developers: See the benefits of navigating between code details and big-picture views to understand the system better.
- For engineering managers: Appreciate how easy-to-update, code-linked documentation can accelerate onboarding and project comprehension.
- For potential contributors: Find clear starting points for contributing to the project.

Everyone should be able to comment on the board, so that's a good place to ask
for clarification on things. Once I update the board to contain the answer and
reply, comments get resolved and hidden.

## Requirements

This extension requires Miro and to enable the [AppExplorer](https://miro.com/oauth/authorize/?response_type=code&client_id=3458764531189693223&redirect_uri=%2Fconfirm-app-install%2F) addon.

## Getting Started

The project is still in an active enough stage that every commit should be a
release. It's not worth the extra effort at the moment, so the best way to run
AppExplorer is to checkout main and build it locally.

```
git clone git@github.com:dropbox/AppExplorer.git
cd AppExplorer

git pull main
npm install -g @vscode/vsce   # On first install
npm install                   # after updates

# Run
rm *.vsix; vsce pack && code --install-extension app-explorer-*.vsix
```

### Running Remotely

When using VSCode connected to a remote system or WSL you may not have the
`code` command available. In this case, you'll need to build without installing
on the command line:

```
# Run
rm *.vsix; vsce pack
```

And then in VSCode run `Extensions: Install from VSIX...` and select the file
that `vsce pack` built.

## Release Notes

- Its best to just build from `main` at this point.
