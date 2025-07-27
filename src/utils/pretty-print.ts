export type PrettyPrint<T> = {
  [K in keyof T]: T[K];
} & {};
