import { Router } from 'express';
import { allQueues, deadLetterQueue, QUEUE_NAMES } from '../queues';

const router = Router();

// GET /api/dashboard - job counts for all queues
router.get('/', async (_req, res) => {
  try {
    const counts: Record<string, any> = {};
    for (const queue of allQueues) {
      counts[queue.name] = await queue.getJobCounts();
    }
    res.json(counts);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dlq - dead letter queue jobs
router.get('/dlq', async (_req, res) => {
  try {
    const jobs = await deadLetterQueue.getJobs('waiting', 0, 49);
    res.json(
      jobs.map(j => ({
        id: j.id,
        name: j.name,
        data: j.data,
        failedReason: j.failedReason,
        timestamp: j.timestamp,
        attemptsMade: j.attemptsMade,
      })),
    );
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
