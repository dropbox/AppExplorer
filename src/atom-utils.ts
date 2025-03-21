import { Atom, createStore } from "jotai/vanilla";

export async function* generatorAtomSubscription<T>(
  store: ReturnType<typeof createStore>,
  atom: Atom<T>,
) {
  let deferred = makeDeferred<T>();
  function onChange() {
    const d = deferred;
    deferred = makeDeferred<T>();
    d.resolve(store.get(atom));
  }

  const unsubscribe = store.sub(atom, onChange);
  try {
    while (true) {
      const value = await deferred.promise;
      yield value;
    }
  } finally {
    unsubscribe();
  }
}

export type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
};

export function makeDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void;
  let reject: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve: resolve!, reject: reject! };
}
