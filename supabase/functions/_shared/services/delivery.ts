import { newToken } from '../crypto.ts';
import { processOutbox, sealToken, type MessagingDeps, type OutboxSummary } from './outbox.ts';

export interface DeliverySummary {
  markedDue: number;
  claimed: number;
  delivered: number;
  suppressed: number;
  retried: number;
  failed: number;
  outbox: OutboxSummary;
}

/**
 * One scheduler tick. Reads the database for everything that is due, so it does not
 * matter if previous ticks were missed, ran twice, or crashed half-way.
 */
export async function runDeliveryCycle(
  deps: MessagingDeps,
  opts: { workerId: string; batchSize?: number; timeBudgetMs?: number },
): Promise<DeliverySummary> {
  const started = Date.now();
  const budget = opts.timeBudgetMs ?? 45_000;
  const batch = opts.batchSize ?? 50;
  const summary: DeliverySummary = {
    markedDue: 0,
    claimed: 0,
    delivered: 0,
    suppressed: 0,
    retried: 0,
    failed: 0,
    outbox: { claimed: 0, sent: 0, retried: 0, failed: 0, skipped: 0 },
  };

  summary.markedDue = await deps.db.rpc<number>('mark_due_letters', { p_now: deps.now().toISOString() });

  while (Date.now() - started < budget) {
    const claimed = await deps.db.rpcRows<{ letter_id: string; attempts: number }>('claim_due_letters', {
      p_worker: opts.workerId,
      p_limit: batch,
      p_now: deps.now().toISOString(),
    });
    if (claimed.length === 0) break;
    summary.claimed += claimed.length;

    for (const { letter_id } of claimed) {
      try {
        // Fresh claim link for recipients who have not created an account yet.
        const token = await newToken();
        const outcome = await deps.db.rpc<string>('complete_letter_delivery', {
          p_letter_id: letter_id,
          p_worker: opts.workerId,
          p_arrival_token_hash: token.hash,
          p_arrival_token_enc: await sealToken(deps.ring, token.token),
          p_now: deps.now().toISOString(),
        });
        if (outcome === 'delivered') summary.delivered++;
        else if (outcome === 'suppressed') summary.suppressed++;
        deps.log('letter_delivery', { letter_id, outcome });
      } catch (error) {
        const outcome = await deps.db
          .rpc<string>('fail_letter_delivery', {
            p_letter_id: letter_id,
            p_worker: opts.workerId,
            p_error: (error as Error).message.slice(0, 300),
            p_now: deps.now().toISOString(),
          })
          .catch(() => 'noop');
        if (outcome === 'failed') summary.failed++;
        else summary.retried++;
        deps.log('letter_delivery_error', { letter_id, outcome, error: (error as Error).message.slice(0, 200) });
      }
    }
    if (claimed.length < batch) break;
  }

  while (Date.now() - started < budget) {
    const o = await processOutbox(deps, opts.workerId, { limit: batch });
    for (const k of Object.keys(o) as Array<keyof OutboxSummary>) summary.outbox[k] += o[k];
    if (o.claimed < batch) break;
  }

  // Proves the whole chain (cron → function → database) is alive; read by ops_health().
  await deps.db
    .rpc('record_worker_heartbeat', { p_summary: { ...summary }, p_now: deps.now().toISOString() })
    .catch((e) => deps.log('heartbeat_failed', { error: (e as Error).message }));
  return summary;
}
