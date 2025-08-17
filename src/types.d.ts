// types.d.ts
declare module "*?raw" {
  const content: string;
  export default content;
}

namespace debug {
  interface Debugger {
    error: (...args: unknown[]) => void;
  }
}
