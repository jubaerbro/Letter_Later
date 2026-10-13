import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer, type AudioStatus } from 'expo-audio';
import { Directory, File, Paths } from 'expo-file-system';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { getPref, setPref } from '@/lib/prefs';
import { BUILT_IN_TRACKS, SOUND_EFFECTS, type SoundEffect, type Track } from './tracks';

/**
 * One app-wide music player.
 *  - Licensed content only: our own generated tracks, or files the user picks from their device.
 *  - Background playback with lock-screen controls on Android (required for >3 min in background).
 *  - Requests exclusive audio focus, so phone calls and other apps pause us cleanly and we
 *    reflect that in the UI from status updates.
 *  - Status updates at 1s intervals to stay light on battery.
 */
interface AudioValue {
  tracks: Track[];
  current: Track | null;
  playing: boolean;
  position: number;
  duration: number;
  volume: number;
  background: boolean;
  soundEffects: boolean;
  play: (track?: Track) => void;
  pause: () => void;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  seek: (seconds: number) => void;
  setVolume: (v: number) => void;
  setBackground: (v: boolean) => void;
  setSoundEffects: (v: boolean) => void;
  addOwnFile: () => Promise<Track | null>;
  removeOwnTrack: (id: string) => void;
  sfx: (name: SoundEffect) => void;
}

const AudioContext = createContext<AudioValue | null>(null);
const OWN_TRACKS_KEY = 'll.music.own';

interface OwnTrack {
  id: string;
  title: string;
  uri: string;
}

export function AudioProvider({ children }: { children: ReactNode }) {
  const playerRef = useRef<AudioPlayer | null>(null);
  const sfxRef = useRef<AudioPlayer | null>(null);
  const [own, setOwn] = useState<OwnTrack[]>([]);
  const [current, setCurrent] = useState<Track | null>(null);
  const [status, setStatus] = useState<Pick<AudioStatus, 'playing' | 'currentTime' | 'duration'>>({ playing: false, currentTime: 0, duration: 0 });
  const [volume, setVolumeState] = useState(0.6);
  const [background, setBackgroundState] = useState(true);
  const [soundEffects, setSoundEffectsState] = useState(true);

  const tracks = useMemo<Track[]>(
    () => [...BUILT_IN_TRACKS, ...own.map((o) => ({ id: o.id, title: o.title, mood: 'From your device', source: { uri: o.uri }, builtIn: false }))],
    [own],
  );
  const tracksRef = useRef(tracks);
  const currentRef = useRef(current);
  useEffect(() => {
    tracksRef.current = tracks;
  }, [tracks]);
  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  useEffect(() => {
    (async () => {
      setVolumeState(await getPref('musicVolume'));
      setBackgroundState(await getPref('musicBackground'));
      setSoundEffectsState(await getPref('soundEffects'));
      try {
        const raw = await AsyncStorage.getItem(OWN_TRACKS_KEY);
        if (raw) setOwn(JSON.parse(raw));
      } catch {}
    })();
    return () => {
      playerRef.current?.remove();
      sfxRef.current?.remove();
    };
  }, []);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: background, interruptionMode: 'doNotMix' }).catch(() => {});
  }, [background]);

  const ensurePlayer = useCallback(() => {
    if (playerRef.current) return playerRef.current;
    const p = createAudioPlayer(null, { updateInterval: 1000 });
    p.addListener('playbackStatusUpdate', (s) => {
      setStatus({ playing: s.playing, currentTime: s.currentTime, duration: s.duration });
      if (s.didJustFinish) {
        // Built-in tracks loop; own files advance to the next track.
        const list = tracksRef.current;
        const cur = currentRef.current;
        if (cur && !cur.builtIn) {
          const i = list.findIndex((t) => t.id === cur.id);
          const nextTrack = list[(i + 1) % list.length];
          setCurrent(nextTrack);
          p.replace(nextTrack.source);
          p.loop = nextTrack.builtIn;
          p.play();
        }
      }
    });
    playerRef.current = p;
    return p;
  }, []);

  const play = useCallback(
    (track?: Track) => {
      const p = ensurePlayer();
      const chosen = track ?? currentRef.current ?? tracksRef.current[0];
      if (!chosen) return;
      if (chosen.id !== currentRef.current?.id) {
        p.replace(chosen.source);
        setCurrent(chosen);
        setPref('musicTrackId', chosen.id);
      }
      p.loop = chosen.builtIn;
      p.volume = volume;
      p.play();
      if (Platform.OS !== 'web') {
        try {
          p.setActiveForLockScreen(true, { title: chosen.title, artist: 'LaterLetter', albumTitle: 'Garden sounds' });
        } catch {}
      }
    },
    [ensurePlayer, volume],
  );

  const pause = useCallback(() => playerRef.current?.pause(), []);

  const step = useCallback(
    (dir: 1 | -1) => {
      const list = tracksRef.current;
      const i = Math.max(0, list.findIndex((t) => t.id === currentRef.current?.id));
      play(list[(i + dir + list.length) % list.length]);
    },
    [play],
  );

  const sfx = useCallback(
    (name: SoundEffect) => {
      if (!soundEffects) return;
      try {
        if (!sfxRef.current) sfxRef.current = createAudioPlayer(null, { updateInterval: 2000 });
        const s = sfxRef.current;
        s.replace(SOUND_EFFECTS[name]);
        s.volume = 0.7;
        s.play();
      } catch {}
    },
    [soundEffects],
  );

  const value = useMemo<AudioValue>(
    () => ({
      tracks,
      current,
      playing: status.playing,
      position: status.currentTime,
      duration: status.duration,
      volume,
      background,
      soundEffects,
      play,
      pause,
      toggle: () => (status.playing ? pause() : play()),
      next: () => step(1),
      previous: () => step(-1),
      seek: (s) => {
        playerRef.current?.seekTo(Math.max(0, s)).catch(() => {});
      },
      setVolume: (v) => {
        const clamped = Math.min(1, Math.max(0, v));
        setVolumeState(clamped);
        if (playerRef.current) playerRef.current.volume = clamped;
        setPref('musicVolume', clamped);
      },
      setBackground: (v) => {
        setBackgroundState(v);
        setPref('musicBackground', v);
      },
      setSoundEffects: (v) => {
        setSoundEffectsState(v);
        setPref('soundEffects', v);
      },
      addOwnFile: async () => {
        if (Platform.OS === 'web') return null;
        const picked = await File.pickFileAsync({ mimeTypes: ['audio/*'] });
        if (picked.canceled || !picked.result) return null;
        const dir = new Directory(Paths.document, 'music');
        if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
        const id = `own-${Date.now()}`;
        const ext = picked.result.name.split('.').pop()?.toLowerCase() ?? 'audio';
        const dest = new File(dir, `${id}.${ext}`);
        picked.result.copy(dest);
        const entry: OwnTrack = { id, title: picked.result.name.replace(/\.[^.]+$/, '').slice(0, 60), uri: dest.uri };
        const next = [...own, entry];
        setOwn(next);
        await AsyncStorage.setItem(OWN_TRACKS_KEY, JSON.stringify(next));
        return { id, title: entry.title, mood: 'From your device', source: { uri: dest.uri }, builtIn: false };
      },
      removeOwnTrack: (id) => {
        const entry = own.find((o) => o.id === id);
        if (entry) {
          try {
            new File(entry.uri).delete();
          } catch {}
        }
        if (currentRef.current?.id === id) {
          playerRef.current?.pause();
          setCurrent(null);
        }
        const next = own.filter((o) => o.id !== id);
        setOwn(next);
        AsyncStorage.setItem(OWN_TRACKS_KEY, JSON.stringify(next)).catch(() => {});
      },
      sfx,
    }),
    [tracks, current, status, volume, background, soundEffects, play, pause, step, sfx, own],
  );

  return <AudioContext.Provider value={value}>{children}</AudioContext.Provider>;
}

export function useAudio(): AudioValue {
  const v = useContext(AudioContext);
  if (!v) throw new Error('useAudio must be used inside AudioProvider');
  return v;
}
