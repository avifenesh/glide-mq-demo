import {
  Queue,
  Worker,
  FlowProducer,
  QueueEvents,
  gracefulShutdown,
} from 'glide-mq';
import type { ConnectionOptions } from 'glide-mq';
import { paymentProcessor } from './processors/payment';
import { inventoryProcessor } from './processors/inventory';
import { shippingProcessor } from './processors/shipping';
import { notificationProcessor } from './processors/notification';
import { analyticsProcessor } from './processors/analytics';

// --- Connection ---

const connection: ConnectionOptions = {
  addresses: [
    {
      host: process.env.VALKEY_HOST || 'localhost',
      port: Number(process.env.VALKEY_PORT) || 6379,
    },
  ],
};

// --- Queue names ---

export const QUEUE_NAMES = {
  payment: 'payment',
  inventory: 'inventory',
  shipping: 'shipping',
  notification: 'notification',
  analytics: 'analytics',
  deadLetter: 'dead-letter',
  orderPipeline: 'order-pipeline',
} as const;

// --- Queues ---

export const paymentQueue = new Queue(QUEUE_NAMES.payment, {
  connection,
  deadLetterQueue: { name: QUEUE_NAMES.deadLetter },
});

export const inventoryQueue = new Queue(QUEUE_NAMES.inventory, { connection });
export const shippingQueue = new Queue(QUEUE_NAMES.shipping, { connection });
export const notificationQueue = new Queue(QUEUE_NAMES.notification, { connection });
export const analyticsQueue = new Queue(QUEUE_NAMES.analytics, { connection });
export const deadLetterQueue = new Queue(QUEUE_NAMES.deadLetter, { connection });
export const orderPipelineQueue = new Queue(QUEUE_NAMES.orderPipeline, { connection });

export const allQueues = [
  paymentQueue,
  inventoryQueue,
  shippingQueue,
  notificationQueue,
  analyticsQueue,
  deadLetterQueue,
  orderPipelineQueue,
];

// --- Workers ---

export const paymentWorker = new Worker(QUEUE_NAMES.payment, paymentProcessor, {
  connection,
  concurrency: 3,
});

export const inventoryWorker = new Worker(QUEUE_NAMES.inventory, inventoryProcessor, {
  connection,
  concurrency: 3,
});

export const shippingWorker = new Worker(QUEUE_NAMES.shipping, shippingProcessor, {
  connection,
  concurrency: 2,
});

export const notificationWorker = new Worker(QUEUE_NAMES.notification, notificationProcessor, {
  connection,
  concurrency: 2,
  limiter: { max: 5, duration: 10000 },
});

export const analyticsWorker = new Worker(QUEUE_NAMES.analytics, analyticsProcessor, {
  connection,
  concurrency: 5,
});

// Order pipeline worker - triggers chain when parent flow completes
export const orderPipelineWorker = new Worker(
  QUEUE_NAMES.orderPipeline,
  async (job) => {
    const { orderId } = job.data;
    await job.log(`Order pipeline complete for ${orderId}, triggering fulfillment chain`);

    // Read children values (payment + inventory results)
    const childrenValues = await job.getChildrenValues();
    await job.log(`Children results: ${JSON.stringify(childrenValues)}`);

    // Trigger the fulfillment chain: shipping -> notification -> analytics
    await shippingQueue.add('ship-order', {
      orderId,
      childrenValues,
    });

    // Small delay so shipping finishes before notification
    await notificationQueue.add('notify-customer', {
      orderId,
      channel: 'email',
    }, { delay: 2000 });

    await analyticsQueue.add('log-order', {
      orderId,
      eventType: 'order_complete',
    }, {
      priority: 10,
      removeOnComplete: true,
    });

    return { orderId, status: 'fulfillment_triggered' };
  },
  { connection, concurrency: 5 },
);

export const allWorkers = [
  paymentWorker,
  inventoryWorker,
  shippingWorker,
  notificationWorker,
  analyticsWorker,
  orderPipelineWorker,
];

// --- FlowProducer ---

export const flowProducer = new FlowProducer({ connection });

// --- QueueEvents ---

export const paymentEvents = new QueueEvents(QUEUE_NAMES.payment, { connection });
export const inventoryEvents = new QueueEvents(QUEUE_NAMES.inventory, { connection });
export const shippingEvents = new QueueEvents(QUEUE_NAMES.shipping, { connection });
export const notificationEvents = new QueueEvents(QUEUE_NAMES.notification, { connection });
export const analyticsEvents = new QueueEvents(QUEUE_NAMES.analytics, { connection });
export const orderPipelineEvents = new QueueEvents(QUEUE_NAMES.orderPipeline, { connection });
export const deadLetterEvents = new QueueEvents(QUEUE_NAMES.deadLetter, { connection });

export const allQueueEvents = [
  paymentEvents,
  inventoryEvents,
  shippingEvents,
  notificationEvents,
  analyticsEvents,
  orderPipelineEvents,
  deadLetterEvents,
];

// --- Job Scheduler: daily report every 30s for demo ---

export async function setupSchedulers() {
  await analyticsQueue.upsertJobScheduler('daily-report', { every: 30000 }, {
    name: 'daily-report',
    data: { eventType: 'scheduled_report', orderId: 'system' },
    opts: { removeOnComplete: true },
  });
}

// --- Worker event logging ---

for (const worker of allWorkers) {
  worker.on('completed', (job: any) => {
    console.log(`[OK] ${worker.name}:${job.id} completed`);
  });
  worker.on('failed', (job: any, err: Error) => {
    console.log(`[ERROR] ${worker.name}:${job?.id} failed - ${err.message}`);
  });
  worker.on('error', (err: Error) => {
    console.error(`[ERROR] ${worker.name} worker error:`, err.message);
  });
}

// --- Graceful shutdown ---

export function setupGracefulShutdown() {
  gracefulShutdown([...allQueues, ...allWorkers, ...allQueueEvents, flowProducer]);
}
