import type { Job } from 'glide-mq';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function shippingProcessor(job: Job): Promise<{ trackingNumber: string }> {
  const { orderId } = job.data;

  await job.log(`Generating shipping label for order ${orderId}`);
  await sleep(500);

  const trackingNumber = `SHIP-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  await job.log(`Tracking number: ${trackingNumber}`);
  return { trackingNumber };
}
