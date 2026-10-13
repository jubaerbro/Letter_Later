import { seasonFor, stageFor, visualGrowth, type Season, type TreeStage } from '@shared/domain/growth.ts';
import type { MailboxItem } from '@/lib/api';

export interface TreeView {
  growth: number;
  stage: TreeStage;
  style: string;
  points: number;
}

/** Visual growth for both trees of a letter. Pure presentation — never affects delivery. */
export function treesFor(item: MailboxItem, now: Date = new Date()): { mine: TreeView | null; theirs: TreeView | null } {
  const arrived = item.display_status === 'arrived' || item.display_status === 'opened' || item.display_status === 'delivered';
  const make = (style: string | null, points: number | null): TreeView => {
    const p = points ?? 0;
    const growth = visualGrowth({ plantedAt: new Date(item.created_at), deliverAt: new Date(item.deliver_at), now, points: p, arrived });
    return { growth, stage: stageFor(growth, arrived), style: style ?? 'oak', points: p };
  };
  return {
    mine: item.my_tree_id ? make(item.my_tree_style, item.my_tree_points) : null,
    theirs: item.their_tree_exists ? make(item.their_tree_style, item.their_tree_points) : null,
  };
}

export function currentSeason(hemisphere: 'north' | 'south' = 'north'): Season {
  return seasonFor(new Date(), hemisphere);
}
