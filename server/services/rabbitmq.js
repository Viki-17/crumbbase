const amqp = require("amqplib");

// Default to 127.0.0.1 to avoid IPv6 issues
const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://127.0.0.1";

const QUEUES = {
  JOBS: "ai.jobs",
  EVENTS: "ai.events",
};

let connection = null;
let channel = null;
let pendingConsumers = [];

async function connectRabbitMQ() {
  if (connection) return;

  try {
    console.log(`Connecting to RabbitMQ at ${RABBITMQ_URL}...`);
    connection = await amqp.connect(RABBITMQ_URL);
    channel = await connection.createChannel();

    // Assert queues with arguments to disable consumer timeout
    // This allows long-running jobs (like folder organization) to complete
    await channel.assertQueue(QUEUES.JOBS, {
      durable: true,
      arguments: {
        "x-consumer-timeout": 0, // 0 = infinite timeout, no timeout
      },
    });
    await channel.assertQueue(QUEUES.EVENTS, { durable: true });

    console.log("RabbitMQ Connected");

    // Register pending consumers
    for (const consumer of pendingConsumers) {
      if (consumer.type === "jobs") {
        await _consumeJobs(consumer.fn);
      } else if (consumer.type === "events") {
        await _consumeEvents(consumer.fn);
      }
    }
    pendingConsumers = [];

    // Handle connection close
    connection.on("close", () => {
      console.error("RabbitMQ Connection Closed. Reconnecting...");
      connection = null;
      channel = null;
      setTimeout(connectRabbitMQ, 5000);
    });

    connection.on("error", (err) => {
      console.error("RabbitMQ Connection Error", err);
    });
  } catch (err) {
    console.error("Failed to connect to RabbitMQ:", err.message);
    setTimeout(connectRabbitMQ, 5000);
  }
}

async function publishJob(message) {
  if (!channel) {
    // If not connected, maybe wait or throw?
    // For now, let's try to connect if not already connecting
    if (!connection) connectRabbitMQ(); // async
    // throw new Error("RabbitMQ not ready");
    // Better: wait a bit?
    await new Promise((r) => setTimeout(r, 1000));
    if (!channel) throw new Error("RabbitMQ not connected");
  }
  try {
    const buffer = Buffer.from(JSON.stringify(message));
    channel.sendToQueue(QUEUES.JOBS, buffer, { persistent: true });
    console.log(
      `[RabbitMQ] Published Job: ${message.type} for ${
        message.chapterId || message.bookId
      }`,
    );
  } catch (err) {
    console.error("Failed to publish job:", err);
    throw err;
  }
}

async function publishEvent(event) {
  if (!channel) return; // Fire and forget for events if offline
  try {
    const buffer = Buffer.from(JSON.stringify(event));
    channel.sendToQueue(QUEUES.EVENTS, buffer, { persistent: true });
  } catch (err) {
    console.error("Failed to publish event:", err);
  }
}

async function consumeJobs(workerFunction) {
  if (!channel) {
    pendingConsumers.push({ type: "jobs", fn: workerFunction });
    if (!connection) connectRabbitMQ();
    return;
  }
  await _consumeJobs(workerFunction);
}

async function _consumeJobs(workerFunction) {
  await channel.prefetch(1);
  console.log("Waiting for messages in ai.jobs...");
  channel.consume(QUEUES.JOBS, async (msg) => {
    if (msg !== null) {
      const content = JSON.parse(msg.content.toString());

      try {
        await workerFunction(content);
        // Acknowledge AFTER successful completion
        // This ensures jobs persist across restarts
        channel.ack(msg);
      } catch (err) {
        console.error("Error processing job:", err);
        // Still acknowledge to prevent infinite retries
        // Since we have progressive storage, partial results are saved
        channel.ack(msg);
      }
    }
  });
}

async function consumeEvents(eventHandler) {
  if (!channel) {
    pendingConsumers.push({ type: "events", fn: eventHandler });
    if (!connection) connectRabbitMQ();
    return;
  }
  await _consumeEvents(eventHandler);
}

async function _consumeEvents(eventHandler) {
  channel.consume(QUEUES.EVENTS, async (msg) => {
    if (msg !== null) {
      const content = JSON.parse(msg.content.toString());
      try {
        eventHandler(content);
        channel.ack(msg);
      } catch (err) {
        console.error("Error processing event:", err);
        channel.ack(msg);
      }
    }
  });
}

module.exports = {
  connectRabbitMQ,
  publishJob,
  publishEvent,
  consumeJobs,
  consumeEvents,
  QUEUES,
};
