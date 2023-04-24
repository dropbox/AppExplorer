export type AnyAsyncFunction = (...args: any[]) => Promise<any>;
export function makeSingleton<T extends AnyAsyncFunction>(t: T) {
  let instance: Promise<ReturnType<Awaited<T>>>;
  type Args = Parameters<T>;

  return (...args: Args) => {
    if (!instance) {
      instance = Promise.resolve().then(() => {
        return t(...args) as ReturnType<T>;
      });
    }
    return instance;
  };
}
