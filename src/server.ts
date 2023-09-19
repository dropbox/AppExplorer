import * as vscode from "vscode";
import { createServer } from "http";
import * as path from "path";
import compression = require("compression");
import express = require("express");
import morgan = require("morgan");
import { Server } from "socket.io";
import { Handler, RequestEvents, ResponseEvents } from "./EventTypes";
import { getRelativePath } from "./extension";

export function makeExpressServer(
  cardsInEditor: Handler<ResponseEvents["cardsInEditor"]>
) {
  const app = express();

  // You need to create the HTTP server from the Express app
  const httpServer = createServer(app);

  // And then attach the socket.io server to the HTTP server
  const io = new Server<ResponseEvents, RequestEvents>(httpServer);

  // Then you can use `io` to listen the `connection` event and get a socket
  // from a client
  io.on("connection", (socket) => {
    // from this point you are on the WS connection with a specific client
    console.log(socket.id, "connected");

    vscode.window.showInformationMessage(`Socket ${socket.id} connected`);

    const uri = vscode.window.activeTextEditor?.document.uri;
    if (uri) {
      const path = getRelativePath(uri);
      if (path) {
        io.emit("activeEditor", path);
      }
    }

    socket.on("cardsInEditor", cardsInEditor);
  });

  app.use(compression());
  app.use(
    "/",
    express.static(path.join(__dirname, "../public"), { index: "index.html" })
  );

  // You may want to be more aggressive with this caching
  // app.use(express.static("public", { maxAge: "1h" }));

  app.use(morgan("tiny"));

  const port = 50505;

  // instead of running listen on the Express app, do it on the HTTP server
  httpServer.listen(port, () => {
    console.log(`Express server listening on port ${port}`);
  });


  return io;
}
