import type { Job } from 'glide-mq';

export async function analyticsProcessor(job: Job): Promise<{ logged: boolean }> {
  const { eventType, orderId } = job.data;
  await job.log(`Analytics: ${eventType || 'order_complete'} for order ${orderId}`);
  return { logged: true };
}
