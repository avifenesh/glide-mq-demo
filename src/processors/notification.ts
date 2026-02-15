import type { Job } from 'glide-mq';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function notificationProcessor(job: Job): Promise<{ sent: boolean; channel: string }> {
  const { orderId, channel } = job.data;
  const ch = channel || 'email';

  await job.log(`Sending ${ch} notification for order ${orderId}`);
  await sleep(100);

  await job.log(`Notification sent via ${ch}`);
  return { sent: true, channel: ch };
}
