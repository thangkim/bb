export type AlertSound = "attention" | "error" | "done";

export const SOUND_SAMPLE_RATE = 44_100;

interface Note {
  at: number;
  frequency: number;
  decay: number;
  gain: number;
}

const SOUND_NOTES: Record<AlertSound, readonly Note[]> = {
  attention: [
    { at: 0, frequency: 659.25, decay: 0.22, gain: 0.55 },
    { at: 0.12, frequency: 880, decay: 0.22, gain: 0.55 },
    { at: 0.24, frequency: 1318.5, decay: 0.35, gain: 0.6 },
    { at: 0.62, frequency: 659.25, decay: 0.22, gain: 0.55 },
    { at: 0.74, frequency: 880, decay: 0.22, gain: 0.55 },
    { at: 0.86, frequency: 1318.5, decay: 0.45, gain: 0.6 },
  ],
  error: [
    { at: 0, frequency: 440, decay: 0.3, gain: 0.6 },
    { at: 0.22, frequency: 329.63, decay: 0.3, gain: 0.6 },
    { at: 0.44, frequency: 261.63, decay: 0.5, gain: 0.65 },
  ],
  done: [
    { at: 0, frequency: 1046.5, decay: 0.35, gain: 0.45 },
    { at: 0.16, frequency: 1567.98, decay: 0.6, gain: 0.45 },
  ],
};

const HARMONICS: readonly { ratio: number; gain: number }[] = [
  { ratio: 1, gain: 1 },
  { ratio: 2, gain: 0.35 },
  { ratio: 3, gain: 0.12 },
];

const ATTACK_SECONDS = 0.005;
const TAIL_SECONDS = 0.1;

export function soundDurationSeconds(sound: AlertSound): number {
  let end = 0;
  for (const note of SOUND_NOTES[sound]) {
    end = Math.max(end, note.at + note.decay * 5);
  }
  return end + TAIL_SECONDS;
}

export function renderSound(
  sound: AlertSound,
  sampleRate: number = SOUND_SAMPLE_RATE,
): Float32Array<ArrayBuffer> {
  const samples = new Float32Array(
    Math.ceil(soundDurationSeconds(sound) * sampleRate),
  );
  for (const note of SOUND_NOTES[sound]) {
    const start = Math.floor(note.at * sampleRate);
    const length = Math.min(
      samples.length - start,
      Math.ceil(note.decay * 5 * sampleRate),
    );
    for (let index = 0; index < length; index += 1) {
      const t = index / sampleRate;
      const envelope =
        (t < ATTACK_SECONDS ? t / ATTACK_SECONDS : 1) *
        Math.exp(-t / note.decay);
      let value = 0;
      for (const harmonic of HARMONICS) {
        value +=
          harmonic.gain *
          Math.sin(2 * Math.PI * note.frequency * harmonic.ratio * t);
      }
      samples[start + index] =
        (samples[start + index] ?? 0) + value * envelope * note.gain * 0.5;
    }
  }
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  if (peak > 0.95) {
    const scale = 0.95 / peak;
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = (samples[index] ?? 0) * scale;
    }
  }
  return samples;
}

export function encodeWav(
  samples: Float32Array,
  sampleRate: number = SOUND_SAMPLE_RATE,
): Uint8Array {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(44 + index * 2, Math.round(clamped * 0x7fff), true);
  }
  return new Uint8Array(buffer);
}
