import type { NtgGwpStage } from '../types';

/** Forward order of the NTG & GWP funnel (PRD §5.4) — same as NTG_GWP_STAGES in config.ts. */
const ORDER: NtgGwpStage[] = [
  'approached',
  'quiz_completed',
  'consultation_delivered',
  'ntg_confirmed',
  'gwp_given',
  'wa_followup_scheduled',
];

/**
 * Why `next` can't be recorded for a consumer whose recorded stages are
 * `history`, or null if it can. Must match ntg_gwp_progression_check
 * (migration 0015): stages only move forward and never repeat, and GWP /
 * WA follow-up come only after NTG is confirmed.
 */
export function funnelStepError(history: NtgGwpStage[], next: NtgGwpStage): string | null {
  const cur = history.length ? Math.max(...history.map((s) => ORDER.indexOf(s))) : -1;
  const nxt = ORDER.indexOf(next);
  if (nxt <= cur) return 'Tahap funnel tidak boleh mundur atau diulang.';
  if (nxt > ORDER.indexOf('ntg_confirmed') && cur < ORDER.indexOf('ntg_confirmed')) {
    return 'GWP dan follow-up WA hanya bisa dicatat setelah NTG terkonfirmasi.';
  }
  return null;
}

/** The furthest of `stages` along the funnel, or undefined if there are none
 * (e.g. the recent rows plus the consumer row's current_stage). */
export function highestStage(stages: (NtgGwpStage | null | undefined)[]): NtgGwpStage | undefined {
  let best: NtgGwpStage | undefined;
  for (const s of stages) if (s && (!best || ORDER.indexOf(s) > ORDER.indexOf(best))) best = s;
  return best;
}
