import * as EventEmitter from "events";

export function listenToAllEvents(
  ee: EventEmitter,
  callback: (eventName: string, ...args: unknown[]) => void,
) {
  const eventCallback = (first: unknown, ...args: unknown[]) => {
    if (
      first &&
      typeof first === "object" &&
      "type" in first &&
      typeof first.type === "string"
    ) {
      callback(first.type, ...args);
    } else if (typeof first === "string") {
      callback(first, ...args);
    } else {
      throw new Error("Invalid event " + JSON.stringify(first));
    }
  };
  const listening: Record<string | symbol, boolean> = {};
  const listenToEvent = (eventName: string | symbol): void => {
    if (listening[eventName]) {
      return;
    }
    listening[eventName] = true;
    ee.on(eventName, eventCallback);
  };
  ee.eventNames().forEach(listenToEvent);
  ee.on("newListener", (eventName) => listenToEvent(eventName));

  return () => {
    Object.keys(listening).forEach((eventName) => {
      ee.off(eventName, eventCallback);
    });
  };
}
