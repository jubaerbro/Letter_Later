import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { RevealMode } from '@shared/domain/reveal.ts';
import { wallTimeToInstant, type Resolution, type WallTime } from '@shared/domain/time.ts';

export interface Draft {
  /** Stable for the life of the draft: retries after a network error can never duplicate a letter. */
  idempotencyKey: string;
  recipient: string;
  recipientName: string | null;
  isSelf: boolean;
  subject: string;
  body: string;
  revealMode: RevealMode;
  showSubject: boolean;
  showPreview: boolean;
  preview: string;
  when: WallTime | null;
  timeZone: string;
}

const KEY = 'll.draft';

function fresh(timeZone: string): Draft {
  return {
    idempotencyKey: randomUUID().replace(/-/g, ''),
    recipient: '',
    recipientName: null,
    isSelf: false,
    subject: '',
    body: '',
    revealMode: 'name_and_date',
    showSubject: false,
    showPreview: false,
    preview: '',
    when: null,
    timeZone,
  };
}

interface ComposeValue {
  draft: Draft;
  update: (patch: Partial<Draft>) => void;
  reset: () => void;
  restored: boolean;
  /** The UTC instant that will be stored, plus how DST affected it. */
  instant: { instant: Date; resolution: Resolution } | null;
}

const ComposeContext = createContext<ComposeValue | null>(null);

export function ComposeProvider({ children, timeZone }: { children: ReactNode; timeZone: string }) {
  const [draft, setDraft] = useState<Draft>(() => fresh(timeZone));
  const [restored, setRestored] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (raw) {
          const saved = JSON.parse(raw) as Draft;
          if (saved.body?.trim() || saved.recipient) {
            setDraft({ ...fresh(timeZone), ...saved });
            setRestored(true);
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        loaded.current = true;
      });
  }, [timeZone]);

  useEffect(() => {
    if (!loaded.current) return;
    const t = setTimeout(() => AsyncStorage.setItem(KEY, JSON.stringify(draft)).catch(() => {}), 400);
    return () => clearTimeout(t);
  }, [draft]);

  const value = useMemo<ComposeValue>(() => {
    let instant: ComposeValue['instant'] = null;
    if (draft.when) {
      try {
        instant = wallTimeToInstant(draft.when, draft.timeZone);
      } catch {
        instant = null;
      }
    }
    return {
      draft,
      restored,
      instant,
      update: (patch) => setDraft((d) => ({ ...d, ...patch })),
      reset: () => {
        AsyncStorage.removeItem(KEY).catch(() => {});
        setDraft(fresh(timeZone));
        setRestored(false);
      },
    };
  }, [draft, restored, timeZone]);

  return <ComposeContext.Provider value={value}>{children}</ComposeContext.Provider>;
}

export function useCompose(): ComposeValue {
  const v = useContext(ComposeContext);
  if (!v) throw new Error('useCompose must be used inside ComposeProvider');
  return v;
}
