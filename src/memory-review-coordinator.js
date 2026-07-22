import { MEMORY_REVIEW_BATCH_SIZE, reviewMemberMemoryBatch } from "./memory-consolidation.js";
import { addSuccessfulRound, backfillMemberRounds, providerForMember } from "./member-rounds.js";

const MEMBERS = ["g", "kimi", "glm", "k"];

export function createMemoryReviewCoordinator({ providers, store, embeddings, logger = console } = {}) {
  const scheduled = new Set();
  let mutationQueue = Promise.resolve();
  let stopped = false;

  const schedule = (memberId) => {
    if (stopped || scheduled.has(memberId)) return;
    scheduled.add(memberId);
    setImmediate(async () => {
      try {
        while (!stopped) {
          const provider = providerForMember(providers, memberId);
          if (!provider) break;
          const rounds = await store.getPendingMemberReview(memberId, MEMORY_REVIEW_BATCH_SIZE);
          if (rounds.length < MEMORY_REVIEW_BATCH_SIZE) break;
          const run = () => reviewMemberMemoryBatch({ provider, memberId, rounds, store, embeddings });
          const task = mutationQueue.then(run, run);
          mutationQueue = task.catch(() => {});
          await task;
        }
      } catch (error) {
        logger?.warn?.(`[memory-review:${memberId}] ${error?.message || error}`);
      } finally {
        scheduled.delete(memberId);
      }
    });
  };

  return {
    schedule,
    async record(memberId, input) {
      const round = await addSuccessfulRound(store, memberId, input);
      if (round) schedule(memberId);
      return round;
    },
    async start() {
      await backfillMemberRounds(store);
      for (const member of MEMBERS) schedule(member);
    },
    stop() { stopped = true; },
  };
}
