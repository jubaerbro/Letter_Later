import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { attachMyLetters, fetchProfile, hasPremium, type Profile } from './api';
import { config } from './config';
import { supabase } from './supabase';

interface SessionValue {
  ready: boolean;
  session: Session | null;
  profile: Profile | null;
  premium: boolean;
  refresh: () => Promise<void>;
  setPremium: (v: boolean) => void;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!config.isConfigured);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [premium, setPremium] = useState(false);
  const attachedFor = useRef<string | null>(null);

  const load = useCallback(async (s: Session | null) => {
    setSession(s);
    if (!s) {
      setProfile(null);
      setPremium(false);
      setReady(true);
      return;
    }
    try {
      const [p, prem] = await Promise.all([fetchProfile(s.user.id), hasPremium(s.user.id)]);
      setProfile(p);
      setPremium(prem);
      // Letters sent to this verified email before the account existed join the mailbox.
      if (p?.onboarded_at && attachedFor.current !== s.user.id) {
        attachedFor.current = s.user.id;
        attachMyLetters().catch(() => {});
      }
    } catch {
      // Offline: keep whatever we had; screens show gentle retry states.
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    if (!config.isConfigured) return;
    supabase.auth.getSession().then(({ data }) => load(data.session));
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'TOKEN_REFRESHED') {
        setSession(s);
        return;
      }
      // Defer to avoid calling Supabase inside the auth callback (supabase-js guidance).
      setTimeout(() => load(s), 0);
    });
    return () => data.subscription.unsubscribe();
  }, [load]);

  const value = useMemo<SessionValue>(
    () => ({
      ready,
      session,
      profile,
      premium,
      setPremium,
      refresh: async () => {
        const { data } = await supabase.auth.getSession();
        await load(data.session);
      },
      signOut: async () => {
        await supabase.auth.signOut();
      },
    }),
    [ready, session, profile, premium, load],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error('useSession must be used inside SessionProvider');
  return v;
}
