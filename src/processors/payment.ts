import type { Job } from 'glide-mq';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function paymentProcessor(job: Job): Promise<{ transactionId: string }> {
  await job.log(`Payment processing started for order ${job.data.orderId}`);
  await job.updateProgress(25);
  await job.log('Validating payment details...');
  await sleep(300);

  await job.updateProgress(50);
  await job.log('Charging payment method...');
  await sleep(400);

  // 30% random failure rate
  if (Math.random() < 0.3) {
    throw new Error('Payment declined by provider');
  }

  await job.updateProgress(75);
  await job.log('Confirming transaction...');
  await sleep(200);

  const transactionId = `txn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await job.log(`Payment confirmed: ${transactionId}`);
  return { transactionId };
}
