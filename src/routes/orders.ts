import { Router } from 'express';
import { flowProducer, paymentQueue, QUEUE_NAMES } from '../queues';

const router = Router();

// POST /api/orders - create an order flow
router.post('/', async (req, res) => {
  try {
    const orderId = `ord_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const { amount, items, customer } = req.body || {};

    const orderData = {
      orderId,
      amount: amount || Math.floor(Math.random() * 500) + 10,
      items: items || [{ sku: 'WIDGET-001', qty: 1 }],
      customer: customer || { email: 'demo@example.com' },
    };

    // FlowProducer: parent = order-pipeline, children = payment + inventory
    const flow = await flowProducer.add({
      name: 'process-order',
      queueName: QUEUE_NAMES.orderPipeline,
      data: orderData,
      children: [
        {
          name: 'charge-payment',
          queueName: QUEUE_NAMES.payment,
          data: orderData,
          opts: {
            timeout: 5000,
            attempts: 3,
            backoff: { type: 'exponential', delay: 1000 },
          },
        },
        {
          name: 'reserve-inventory',
          queueName: QUEUE_NAMES.inventory,
          data: orderData,
          opts: {
            deduplication: { id: orderId, mode: 'simple' },
          },
        },
      ],
    });

    res.json({
      orderId,
      jobId: flow.job.id,
      status: 'created',
      children: flow.children?.map(c => ({
        queue: c.job.name,
        jobId: c.job.id,
      })),
    });
  } catch (err: any) {
    console.error('[ERROR] Failed to create order:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/orders/:id - revoke an order
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await paymentQueue.revoke(id);
    res.json({ jobId: id, result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/orders - list recent orders from completed/failed
router.get('/', async (req, res) => {
  try {
    const [completed, failed] = await Promise.all([
      paymentQueue.getJobs('completed', 0, 19),
      paymentQueue.getJobs('failed', 0, 19),
    ]);

    const orders = [
      ...completed.map(j => ({
        id: j.id,
        orderId: j.data?.orderId,
        status: 'completed',
        result: j.returnvalue,
        timestamp: j.finishedOn || j.timestamp,
      })),
      ...failed.map(j => ({
        id: j.id,
        orderId: j.data?.orderId,
        status: 'failed',
        reason: j.failedReason,
        timestamp: j.finishedOn || j.timestamp,
      })),
    ].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    res.json(orders);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
