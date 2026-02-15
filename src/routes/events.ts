import { Router } from 'express';
import type { Request, Response } from 'express';
import { allQueueEvents } from '../queues';

const router = Router();

// GET /api/events - SSE endpoint
router.get('/', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Send initial ping
  res.write('data: {"type":"connected"}\n\n');

  const eventTypes = [
    'added', 'completed', 'failed', 'progress',
    'retrying', 'stalled', 'revoked', 'promoted',
  ];

  const listeners: Array<{ qe: typeof allQueueEvents[0]; event: string; handler: (...args: any[]) => void }> = [];

  for (const qe of allQueueEvents) {
    for (const eventType of eventTypes) {
      const handler = (payload: any) => {
        const data = JSON.stringify({
          type: eventType,
          queue: qe.name,
          ...payload,
        });
        res.write(`data: ${data}\n\n`);
      };
      qe.on(eventType, handler);
      listeners.push({ qe, event: eventType, handler });
    }
  }

  // Heartbeat every 15s to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 15000);

  // Cleanup on disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    for (const { qe, event, handler } of listeners) {
      qe.removeListener(event, handler);
    }
  });
});

export default router;
