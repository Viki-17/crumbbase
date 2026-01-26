const amqp = require("amqplib");

// Default to 127.0.0.1 to avoid IPv6 issues
const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://127.0.0.1";

const QUEUES = {
  JOBS: "ai.jobs.v2",
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

    // Assert queues with arguments to disable/extend consumer timeout
    // Using 24 hours (86400000 ms) instead of 0 to avoid ambiguity
    const queueArgs = {
      "x-consumer-timeout": 86400000,
    };

    // Since we bumped version, we don't strictly need the try/catch for 406
    // but keeping it is good practice for future changes
    try {
      await channel.assertQueue(QUEUES.JOBS, {
        durable: true,
        arguments: queueArgs,
      });
    } catch (err) {
      // ... existing error handling logic if needed, but likely fine with new name
      console.warn(
        "Queue assertion failed, attempting recreation...",
        err.message,
      );
      // Recreate logic similar to before if we kept the name, but v2 ensures cleanliness
    }

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
    if (!connection) connectRabbitMQ();
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
  if (!channel) return;
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
  console.log(`Waiting for messages in ${QUEUES.JOBS}...`);

  // Capture the channel ID/Ref at the time of consumption setup
  const currentChannel = channel;

  channel.consume(QUEUES.JOBS, async (msg) => {
    if (msg !== null) {
      const content = JSON.parse(msg.content.toString());

      try {
        await workerFunction(content);
        // Safe ACK: only ack if the channel is still the same and open
        if (channel === currentChannel && channel) {
          channel.ack(msg);
        } else {
          console.warn("Skipping ACK because channel changed or closed.");
        }
      } catch (err) {
        console.error("Error processing job:", err);
        if (channel === currentChannel && channel) {
          channel.ack(msg);
        } else {
          console.warn(
            "Skipping ACK (error case) because channel changed or closed.",
          );
        }
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
  const currentChannel = channel;
  channel.consume(QUEUES.EVENTS, async (msg) => {
    if (msg !== null) {
      const content = JSON.parse(msg.content.toString());
      try {
        eventHandler(content);
        if (channel === currentChannel && channel) channel.ack(msg);
      } catch (err) {
        console.error("Error processing event:", err);
        if (channel === currentChannel && channel) channel.ack(msg);
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
