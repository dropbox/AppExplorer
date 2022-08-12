export function unique<T>(arr: Array<T>): Array<T> {
  return [...new Set(arr)];
}
