import type { AudioSource } from 'expo-audio';

export interface Track {
  id: string;
  title: string;
  mood: string;
  source: AudioSource;
  /** Built-in tracks are original, procedurally generated for this app (see assets/audio/LICENSE.md). */
  builtIn: boolean;
}

export const BUILT_IN_TRACKS: Track[] = [
  { id: 'morning-dew', title: 'Morning Dew', mood: 'Soft chords and little bells', source: require('../../../assets/audio/morning-dew.m4a'), builtIn: true },
  { id: 'rain-on-leaves', title: 'Rain on Leaves', mood: 'Gentle rain with a warm hum', source: require('../../../assets/audio/rain-on-leaves.m4a'), builtIn: true },
  { id: 'starlit-orchard', title: 'Starlit Orchard', mood: 'A slow music-box melody', source: require('../../../assets/audio/starlit-orchard.m4a'), builtIn: true },
  { id: 'hearth-and-hush', title: 'Hearth & Hush', mood: 'Crackling fire, deep and calm', source: require('../../../assets/audio/hearth-and-hush.m4a'), builtIn: true },
];

export const SOUND_EFFECTS = {
  water: require('../../../assets/audio/sfx-water.m4a'),
  sunlight: require('../../../assets/audio/sfx-sunlight.m4a'),
  moment: require('../../../assets/audio/sfx-breathe.m4a'),
  seal: require('../../../assets/audio/sfx-seal.m4a'),
  bloom: require('../../../assets/audio/sfx-bloom.m4a'),
} as const;
export type SoundEffect = keyof typeof SOUND_EFFECTS;
