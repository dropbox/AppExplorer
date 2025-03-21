import { createWSClient, wsLink } from "@trpc/client";
import * as trpcExpress from "@trpc/server/adapters/express";
import { applyWSSHandler } from "@trpc/server/adapters/ws";
import * as ws from "ws";

import { createServer } from "http";
import { createTRPCJotai } from "jotai-trpc";
import { atom, getDefaultStore } from "jotai/vanilla";
import * as path from "path";
import * as vscode from "vscode";
import { z } from "zod";
import {
  cardNavigationAtom,
  getBoardIdFromMiroLink,
  storageAtom,
} from "./card-storage";
import { Queries, QueryKeys, zCardData } from "./EventTypes";
import {
  miroQueriesProcedure,
  miroQueryAtom,
  resolveMiroQueryProcedure,
} from "./miro-query-atom";
import { publicProcedure, router } from "./trpc";
import { createContext } from "./trpc-context";
import compression = require("compression");
import express = require("express");
import morgan = require("morgan");
const store = getDefaultStore();

export type AppRouter = typeof appRouter;

const port = 9042;
const lookupBoardFromLinkAtom = atom(null, (get, _set, miroLink: string) => {
  const boardId = getBoardIdFromMiroLink(miroLink);
  if (!boardId) {
    return get(storageAtom).find((b) => get(b).id === boardId);
  }
  return undefined;
});

const clock = publicProcedure.subscription(async function* () {
  let d = new Date();
  while (true) {
    d = new Date();
    console.log("clock", d);
    yield String(d);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
});

const appRouter = router({
  clock,
  echo: publicProcedure.input(z.string()).query(({ input }) => {
    return "echo:" + input;
  }),
  miroQueries: miroQueriesProcedure,
  resolveMiroQuery: resolveMiroQueryProcedure,
  updateCard: publicProcedure
    .input(zCardData)
    .mutation(async ({ ctx, input }) => {
      const miroLink = input?.miroLink;
      const boardAtom = miroLink
        ? ctx.store.set(lookupBoardFromLinkAtom, miroLink)
        : undefined;
      if (boardAtom && miroLink) {
        ctx.store.set(boardAtom, (prev) => {
          return {
            ...prev,
            cards: {
              ...prev.cards,
              [miroLink]: input,
            },
          };
        });
      }
    }),
  navigateToCard: publicProcedure
    .input(zCardData)
    .mutation(async ({ ctx, input }) => {
      ctx.store.set(cardNavigationAtom, input);
    }),
  deleteCard: publicProcedure
    .input(z.string())
    .mutation(async ({ ctx, input }) => {
      const miroLink = input;
      const boardAtom = miroLink
        ? ctx.store.set(lookupBoardFromLinkAtom, miroLink)
        : undefined;
      if (boardAtom && miroLink) {
        ctx.store.set(boardAtom, (prev) => {
          const cards = { ...prev.cards };
          delete cards[miroLink];
          return {
            ...prev,
            cards,
          };
        });
      }
    }),
});

// @ts-expect-error
global.WebSocket ??= ws;
const wsClient = createWSClient({
  url: `ws://localhost:${port}`,
});

const trpc = createTRPCJotai<AppRouter>({
  links: [
    wsLink({
      client: wsClient,
    }),
  ],
});

export class MiroServer {
  subscriptions = [] as vscode.Disposable[];
  httpServer?: ReturnType<typeof createServer>;

  constructor() {
    const echoAtom = trpc.clock.atomWithSubscription(undefined);

    console.log("echoAtom", store.get(echoAtom));
    store.sub(echoAtom, async () => {
      console.log("echo sub?");
      const response = store.get(echoAtom);
      console.log("echo", response);

      if (response) {
        vscode.window.showInformationMessage(`AppExplorer - ${response}`);
      }
    });
  }

  startServer() {
    const app = express();
    app.use(
      "/trpc",
      trpcExpress.createExpressMiddleware({
        router: appRouter,
        createContext,
      }),
    );

    this.httpServer = createServer(app);
    const wss = new ws.Server({
      server: this.httpServer,
    });

    const handler = applyWSSHandler({
      wss,
      router: appRouter,
      createContext,
      keepAlive: {
        enabled: true,
      },
    });
    process.on("SIGTERM", () => {
      console.log("SIGTERM");
      handler.broadcastReconnectNotification();
      wss.close();
    });

    app.use(compression());
    app.use(
      "/",
      express.static(path.join(__dirname, "../public"), {
        index: "index.html",
      }),
    );

    app.use(morgan("tiny"));

    const port = 9042;

    this.httpServer.on("error", (e) => {
      vscode.window.showErrorMessage(`AppExplorer - ${String(e)}`);
    });
    this.httpServer.listen(port, () => {
      vscode.window.showInformationMessage(
        `AppExplorer - Server started. Open a Miro board to connect.`,
      );
    });
  }
  stopServer = () => {
    this.httpServer?.closeAllConnections();
    this.httpServer = undefined;
  };

  dispose() {
    this.subscriptions.forEach((s) => s.dispose());
    this.stopServer();
  }

  async query<Req extends QueryKeys, Res extends ReturnType<Queries[Req]>>(
    boardId: string,
    name: Req,
    ...data: Parameters<Queries[Req]>
  ): Promise<Res> {
    const response: any = await store.set(
      miroQueryAtom,
      // @ts-expect-error
      boardId,
      name,
      ...data,
    );
    return response;
  }
}
