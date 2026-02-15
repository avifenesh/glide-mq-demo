import type { Job } from 'glide-mq';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function inventoryProcessor(job: Job): Promise<{ reserved: boolean; sku: string }> {
  const { orderId, items } = job.data;
  const sku = items?.[0]?.sku || 'SKU-UNKNOWN';

  await job.log(`Checking inventory for order ${orderId}, SKU: ${sku}`);
  await sleep(200);

  await job.log(`Inventory reserved for ${sku}`);
  return { reserved: true, sku };
}
