import EventEmitter = require("events");

export function listenToAllEvents(
  ee: EventEmitter,
  callback: (eventName: string, ...args: unknown[]) => void,
) {
  const listening: Record<string | symbol, boolean> = {};
  const listenToEvent = (eventName: string | symbol): void => {
    if (listening[eventName]) {
      return;
    }
    listening[eventName] = true;
    ee.on(eventName, callback);
  };
  ee.eventNames().forEach(listenToEvent);
  ee.on("newListener", (eventName) => listenToEvent(eventName));

  return () => {
    Object.keys(listening).forEach((eventName) => {
      ee.off(eventName, callback);
    });
  };
}
