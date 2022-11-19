Development Board:

https://miro.com/app/board/uXjVPBl8yvs=/?share_link_id=320309705902

Miro App:

https://miro.com/oauth/authorize/?response_type=code&client_id=3458764531189693223&redirect_uri=%2Fconfirm-app-install%2F

# App Explorer

This app uses the [Miro Web SDK][websdk] to diagram important landmarks in your
code, or other patterns you may want to scan for. It runs as a web server on
https://localhost:50505 and scans other projects on your machine.

To start the server run `npm install` then:

```
REPO_ROOT=/path/to/project npm run dev
REPO_ROOT=$PWD npm run dev
```

[websdk]: https://developers.miro.com/docs/miro-web-sdk-introduction
