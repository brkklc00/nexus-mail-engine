import type { Job } from "bullmq";
import { deliveryQueue, type DeliveryJob } from "@nexus/queue";

export async function processRetry(job: Job<DeliveryJob>) {
  await deliveryQueue.add("delivery_from_retry", {
    ...job.data
  });
}
