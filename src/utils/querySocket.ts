import { Socket as ServerSocket } from "socket.io";
import { Socket as ClientSocket } from "socket.io-client";
import { v4 as uuidv4 } from "uuid";
import {
  EventMapType,
  QueryFunction,
  QueryResultFunction,
} from "../EventTypes";

// Helper type to extract event map from socket type
type ExtractEventMap<T> =
  T extends ClientSocket<QueryResultFunction<infer E>, QueryFunction<infer E>>
    ? E
    : T extends ServerSocket<
          QueryResultFunction<infer E>,
          QueryFunction<infer E>
        >
      ? E
      : "Unable to infer event map from socket type";
export async function querySocket<
  S extends
    | ClientSocket<QueryResultFunction<any>, QueryFunction<any>>
    | ServerSocket<QueryResultFunction<any>, QueryFunction<any>>,
  E extends EventMapType = ExtractEventMap<S>,
  Req extends keyof E = keyof E,
  Res extends ReturnType<E[Req]> = ReturnType<E[Req]>,
>(
  socket: S,
  boardId: string,
  name: Req,
  ...data: Parameters<E[Req]>
): Promise<Res> {
  return new Promise<Res>((resolve, reject) => {
    const requestId = uuidv4();
    socket.emit("query", {
      boardId,
      requestId,
      query: name,
      data,
      resolve,
      reject,
    });
  });
}
