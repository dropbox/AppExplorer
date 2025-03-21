import { atom, PrimitiveAtom, WritableAtom } from "jotai/vanilla";
import { z } from "zod";
import {
  Deferred,
  generatorAtomSubscription,
  makeDeferred,
} from "./atom-utils";
import { activeBoardsConnectionsAtom } from "./card-storage";
import { Queries, QueryKeys } from "./EventTypes";
import { publicProcedure } from "./trpc";

type QueryRequest<T extends QueryKeys = QueryKeys> = {
  boardId: string;
  id: string;
  method: T;
  args: Parameters<Queries[T]>;
  deferred: Deferred<Awaited<ReturnType<Queries[T]>>>;
};

type ClientQueryRequest<T extends QueryKeys = QueryKeys> = Omit<
  QueryRequest<T>,
  "deferred"
>;

type QueryRequestAtom<T extends QueryKeys = QueryKeys> = WritableAtom<
  QueryRequest<T>,
  [Awaited<ReturnType<Queries[T]>>],
  void
>;

const inFlightRequestsAtom: PrimitiveAtom<
  Record<string, QueryRequestAtom<QueryKeys>>
> = atom({});

type MethodAndArgs<T extends QueryKeys = QueryKeys> = [
  T,
  ...Parameters<Queries[T]>,
];

function makeRequestAtom<T extends QueryKeys>(
  boardId: string,
  method: T,
  ...args: Parameters<Queries[T]>
): QueryRequestAtom<T> {
  type ResultType = Awaited<ReturnType<Queries[typeof method]>>;
  const id = crypto.randomUUID() as string;
  const requestAtom: QueryRequestAtom<T> = atom(
    {
      boardId,
      id,
      method,
      args,
      deferred: makeDeferred<ResultType>(),
    },
    (get, set, result: Awaited<ReturnType<Queries[T]>>) => {
      get(requestAtom).deferred.resolve(result);
      set(inFlightRequestsAtom, (prev) => {
        const newState = { ...prev };
        delete newState[id];
        return newState;
      });
    },
  );
  return requestAtom;
}

const clientQueryAtom = atom((get): ClientQueryRequest[] =>
  get(miroQueryAtom).map((requestAtom): ClientQueryRequest => {
    const { deferred, ...clientData } = get(requestAtom);
    return clientData;
  }),
);

export const miroQueriesProcedure = publicProcedure
  .input(z.string())
  .subscription(async function* ({
    ctx,
    input: boardId,
  }): AsyncGenerator<ClientQueryRequest[]> {
    try {
      ctx.store.set(activeBoardsConnectionsAtom, (prev) =>
        prev.concat(boardId),
      );
      ctx.store.set(miroQueryAtom, boardId, "echo", `BoardId: ${boardId}`);
      yield* generatorAtomSubscription(ctx.store, clientQueryAtom);
    } finally {
      ctx.store.set(activeBoardsConnectionsAtom, (prev) =>
        prev.filter((b) => b !== boardId),
      );
    }
  });
export const resolveMiroQueryProcedure = publicProcedure
  .input(
    z.object({
      requestId: z.string(),
      response: z.any(),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    const { requestId, response } = input;
    const requestAtom = ctx.store.get(inFlightRequestsAtom)[requestId];
    if (requestAtom) {
      ctx.store.set(requestAtom, response);
    }
    return response;
  });

export const miroQueryAtom = atom(
  (get) => {
    return Object.values(get(inFlightRequestsAtom));
  },
  (
    get,
    set,
    boardId: string,
    ...[method, ...args]: MethodAndArgs<QueryKeys>
  ) => {
    const id = crypto.randomUUID() as string;
    const requestAtom = makeRequestAtom(boardId, method, ...args);
    set(inFlightRequestsAtom, (prev) => {
      return {
        ...prev,
        [id]: requestAtom,
      };
    });
    return get(requestAtom).deferred.promise;
  },
);
