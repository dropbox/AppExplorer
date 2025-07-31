import { Socket as ServerSocket } from "socket.io";
import { Socket as ClientSocket } from "socket.io-client";

/**
 * Fully generic type-safe promiseEmit utility function
 *
 * Wraps socket.io callback-based events with promises, providing full type safety
 * by extracting all type information directly from the socket's event map.
 *
 * This approach has been tested and verified to work with socket.io v4.8.1.
 */

// Extract the event map from a socket type
type ExtractEventMap<TSocket> =
  TSocket extends ServerSocket<infer EventMapB, infer EventMapA>
    ? EventMapA & EventMapB
    : TSocket extends ClientSocket<infer EventMapB, infer EventMapA>
      ? EventMapA & EventMapB
      : never;

// Extract events that have callbacks (return promises)
type CallbackEvents<T> = {
  [K in keyof T]: T[K] extends (
    ...args: [...infer Args, (result: infer R) => void]
  ) => void
    ? { args: Args; result: R }
    : T[K] extends (callback: (result: infer R) => void) => void
      ? { args: []; result: R }
      : never;
};

// Filter to only callback-based event names
type CallbackEventNames<T> = {
  [K in keyof T]: CallbackEvents<T>[K] extends never
    ? never
    : K extends string
      ? K
      : never;
}[keyof T];

// Extract parameter types (excluding callback)
type EventParams<T, K extends keyof T> = CallbackEvents<T>[K] extends {
  args: infer Args;
}
  ? Args extends readonly unknown[]
    ? Args
    : []
  : [];

// Extract return type from callback
type EventResult<T, K extends keyof T> = CallbackEvents<T>[K] extends {
  result: infer R;
}
  ? R
  : never;

/**
 * Fully generic type-safe promiseEmit function
 *
 * Extracts all type information directly from the socket's event map.
 * Works with any socket type (ServerSocket or ClientSocket) and any event interface.
 *
 * @param socket - The socket.io socket (ServerSocket or ClientSocket)
 * @param eventName - Event name (must be a callback-based event from the socket's event map)
 * @param args - Event parameters (automatically inferred, excluding the callback)
 * @returns Promise that resolves with the callback result type
 *
 * @example
 * ```typescript
 * // Works with any socket type - TypeScript automatically infers everything:
 * const boardInfo = await promiseEmit(miroSocket, "getBoardInfo");
 * const workspaceData = await promiseEmit(workspaceSocket, "someWorkspaceEvent");
 *
 * // TypeScript will show error for invalid event names or wrong parameters
 * const invalid = await promiseEmit(socket, "invalidEvent"); // ❌ Compile error
 * ```
 */
export function promiseEmit<
  // The correct types are extracted from these anys
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TSocket extends ServerSocket<any, any> | ClientSocket<any, any>,
  TEventMap extends ExtractEventMap<TSocket>,
  TEventName extends CallbackEventNames<TEventMap>,
>(
  socket: TSocket,
  eventName: TEventName,
  ...args: EventParams<TEventMap, TEventName>
): Promise<EventResult<TEventMap, TEventName>> {
  return new Promise<EventResult<TEventMap, TEventName>>((resolve, reject) => {
    try {
      // Create the callback function that will be passed as the last argument
      const callback = (result: EventResult<TEventMap, TEventName>) => {
        resolve(result);
      };

      // Emit the event with all arguments plus the callback
      // Socket.io automatically handles the callback routing
      socket.emit(eventName, ...args, callback);
    } catch (error) {
      reject(error);
    }
  });
}
