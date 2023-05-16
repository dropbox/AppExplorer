# AppExplorer

This project isn't quite designed to be compiled and deployed, because it can pull in
some code from the target repository. It's designed to run locally. Miro expects to find the
app at http://localhost:50505/.

Quick Start (Explore AppExplorer's codebase):

You can simply run AppExplorer as a webserver to explore what it has to offer.
Then when you're ready, [install the miro app][install]. Each time you launch
Miro it's going to check to see whether this service is available or not. If
it's not, then the button won't show up in Miro, so sometimes you need to
refresh the page after starting AppExplorer

```sh
git clone git@github.com:dropbox/AppExplorer.git
cd AppExplorer
npm install
npm run dev
```

To explore your codebase, this uses an environment variable `REPO_ROOT` and `AppExplorer.json`.

```sh
echo '{"name":"OtherProject","root":"src"}' > ../other-project/AppExplorer.json
REPO_ROOT=../other-project npm run dev
```

## Project config

AppExplorer needs some metadata about the project it's going to scan. Create
`other-project/AppExplorer.json` with a `name` and `root`. See
`AppExplorer/AppExplorer.json` for an example, becuase the project always scans
itself.

If `other-project` has some project specific tooling you'd like to use, you can
create `AppExplorer/tool-name.tsx` and it will get copied into `AppExplorer`
when it runs. It gets copied into a path that git ignores, and changes you make
to that file are written back to the original repository.

[install]: https://miro.com/oauth/authorize/?response_type=code&client_id=3458764531189693223&redirect_uri=%2Fconfirm-app-install%2F
