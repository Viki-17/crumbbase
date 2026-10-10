// In-process event bus — replaces RabbitMQ ai.events queue.
// The API and worker run in the SAME process (see server/index.js), so a
// durable events queue was pure overhead: publish -> broker -> consume ->
// broadcast(bookId). Now publish -> subscribers (SSE broadcast) directly,
// mirroring learncache which broadcasts from the embedded worker.
const { EventEmitter } = require("events");

const bus = new EventEmitter();
bus.setMaxListeners(50);

// Back-compat shim: same signature as rabbitmq.publishEvent(event)
function publishEvent(event) {
  // Emit async so publishers never block on slow SSE clients
  setImmediate(() => bus.emit("event", event));
}

// Back-compat shim: same signature as rabbitmq.consumeEvents(handler)
function consumeEvents(handler) {
  bus.on("event", (event) => {
    try {
      handler(event);
    } catch (err) {
      console.error("[Events] handler error:", err);
    }
  });
}

module.exports = { publishEvent, consumeEvents, bus };
