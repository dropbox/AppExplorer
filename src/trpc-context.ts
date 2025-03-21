import { getDefaultStore } from "jotai/vanilla";

export const createContext = () => ({
  store: getDefaultStore(),
}); // no context

export type Context = Awaited<ReturnType<typeof createContext>>;
