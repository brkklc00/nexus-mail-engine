import type { FairSchedulerSlot } from "@nexus/domain";

export class FairCampaignScheduler {
  private cursor = 0;

  nextBatch(slots: FairSchedulerSlot[], maxJobs: number): FairSchedulerSlot[] {
    if (slots.length === 0 || maxJobs <= 0) {
      return [];
    }

    const runnable = slots
      .filter((slot) => slot.remaining > 0)
      .sort((a, b) => b.priority - a.priority);

    if (runnable.length === 0) {
      return [];
    }

    const selected: FairSchedulerSlot[] = [];
    let guard = 0;
    while (selected.length < maxJobs && guard < maxJobs * 8) {
      const index = this.cursor % runnable.length;
      const slot = runnable[index];
      this.cursor += 1;
      guard += 1;

      if (slot.remaining <= 0) {
        continue;
      }

      slot.remaining -= 1;
      selected.push(slot);
    }

    return selected;
  }
}
