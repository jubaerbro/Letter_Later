/**
 * Visual tree growth. This is purely cosmetic and is computed from data the server already
 * has; it is deliberately separate from the delivery countdown. Nothing here (or anywhere)
 * can move a letter's deliver_at.
 *
 *   growth = time + (1 - time) * nurtureBoost
 *
 * - `time` is how far we are between planting and the opening date (0..1).
 * - `nurtureBoost` rises gently with care points and saturates, so caring helps a tree
 *   planted for a far-away date look lively, but missing days never shrinks anything.
 * - Growth is capped below 1 until the letter actually arrives; "bloom" is reserved for
 *   the real opening date.
 */

export const TREE_STAGES = ['seed', 'sprout', 'sapling', 'young', 'mature', 'bloom'] as const;
export type TreeStage = (typeof TREE_STAGES)[number];

export const TREE_STYLES = ['oak', 'cherry', 'willow', 'maple', 'birch', 'lantern', 'starlight'] as const;
export type TreeStyle = (typeof TREE_STYLES)[number];

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

const MAX_BOOST = 0.35;
const BOOST_SCALE = 24; // points for ~63% of the max boost
const PRE_BLOOM_CAP = 0.985;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function timeProgress(plantedAt: Date, deliverAt: Date, now: Date): number {
  const span = deliverAt.getTime() - plantedAt.getTime();
  if (span <= 0) return 1;
  return clamp01((now.getTime() - plantedAt.getTime()) / span);
}

export function nurtureBoost(points: number): number {
  if (!Number.isFinite(points) || points <= 0) return 0;
  return MAX_BOOST * (1 - Math.exp(-points / BOOST_SCALE));
}

export function visualGrowth(input: { plantedAt: Date; deliverAt: Date; now: Date; points: number; arrived: boolean }): number {
  if (input.arrived) return 1;
  const t = timeProgress(input.plantedAt, input.deliverAt, input.now);
  return Math.min(PRE_BLOOM_CAP, t + (1 - t) * nurtureBoost(input.points));
}

export function stageFor(growth: number, arrived: boolean): TreeStage {
  if (arrived) return 'bloom';
  if (growth < 0.1) return 'seed';
  if (growth < 0.3) return 'sprout';
  if (growth < 0.55) return 'sapling';
  if (growth < 0.8) return 'young';
  return 'mature';
}

/** Progress within the current stage (0..1), for subtle in-between scaling. */
export function stageProgress(growth: number): number {
  const bounds = [0, 0.1, 0.3, 0.55, 0.8, 1];
  for (let i = 0; i < bounds.length - 1; i++) {
    if (growth < bounds[i + 1]) return (growth - bounds[i]) / (bounds[i + 1] - bounds[i]);
  }
  return 1;
}

export function seasonFor(date: Date, hemisphere: 'north' | 'south' = 'north'): Season {
  const m = date.getMonth(); // local month is what people feel
  const north: Season = m <= 1 || m === 11 ? 'winter' : m <= 4 ? 'spring' : m <= 7 ? 'summer' : 'autumn';
  if (hemisphere === 'north') return north;
  return ({ winter: 'summer', spring: 'autumn', summer: 'winter', autumn: 'spring' } as const)[north];
}

export const NURTURE_ACTIONS = {
  water: { label: 'Water', points: 1, description: 'A gentle drink for the roots.' },
  sunlight: { label: 'Sunlight', points: 1, description: 'Gather a little warm light.' },
  moment: { label: 'A quiet moment', points: 2, description: 'Breathe slowly with your tree for a few seconds.' },
} as const;
export type NurtureKind = keyof typeof NURTURE_ACTIONS;

export const STAGE_LABELS: Record<TreeStage, string> = {
  seed: 'Seed',
  sprout: 'Sprout',
  sapling: 'Sapling',
  young: 'Young tree',
  mature: 'Mature tree',
  bloom: 'In bloom',
};
