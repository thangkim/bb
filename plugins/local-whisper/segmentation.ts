export const SAMPLE_RATE = 16_000;
export const FRAME_SAMPLES = 480;
export const SPEECH_THRESHOLD_DBFS = -45;
export const MIN_PAUSE_MS = 400;
export const MIN_SEGMENT_SPEECH_MS = 300;
export const SEGMENT_PADDING_MS = 200;

export interface SpeechSegment {
  readonly start: number;
  readonly speechStart: number;
  readonly speechEnd: number;
  readonly end: number;
}

function msToFrames(ms: number): number {
  return Math.round((ms * SAMPLE_RATE) / 1000 / FRAME_SAMPLES);
}

function frameIsSpeech(samples: Int16Array, frame: number): boolean {
  const start = frame * FRAME_SAMPLES;
  const end = Math.min(samples.length, start + FRAME_SAMPLES);
  let sumSquares = 0;
  for (let index = start; index < end; index += 1) {
    const value = samples[index]! / 32768;
    sumSquares += value * value;
  }
  const rms = Math.sqrt(sumSquares / Math.max(1, end - start));
  return rms > 0 && 20 * Math.log10(rms) > SPEECH_THRESHOLD_DBFS;
}

export function findSpeechSegments(samples: Int16Array): SpeechSegment[] {
  const frameCount = Math.ceil(samples.length / FRAME_SAMPLES);
  const minPauseFrames = msToFrames(MIN_PAUSE_MS);
  const runs: Array<{ startFrame: number; endFrame: number }> = [];
  let runStart: number | null = null;
  let lastSpeech = -1;
  for (let frame = 0; frame < frameCount; frame += 1) {
    if (!frameIsSpeech(samples, frame)) continue;
    if (runStart !== null && frame - lastSpeech - 1 >= minPauseFrames) {
      runs.push({ startFrame: runStart, endFrame: lastSpeech + 1 });
      runStart = null;
    }
    runStart ??= frame;
    lastSpeech = frame;
  }
  if (runStart !== null) {
    runs.push({ startFrame: runStart, endFrame: lastSpeech + 1 });
  }

  const minSpeechFrames = msToFrames(MIN_SEGMENT_SPEECH_MS);
  const merged: Array<{ startFrame: number; endFrame: number }> = [];
  let pendingStart: number | null = null;
  runs.forEach((run, index) => {
    const startFrame = pendingStart ?? run.startFrame;
    const isLast = index === runs.length - 1;
    if (!isLast && run.endFrame - run.startFrame < minSpeechFrames) {
      pendingStart = startFrame;
      return;
    }
    pendingStart = null;
    merged.push({ startFrame, endFrame: run.endFrame });
  });

  const padding = Math.round((SEGMENT_PADDING_MS * SAMPLE_RATE) / 1000);
  return merged.map((run, index) => {
    const previousEnd =
      index === 0 ? 0 : merged[index - 1]!.endFrame * FRAME_SAMPLES;
    const nextStart =
      index === merged.length - 1
        ? samples.length
        : merged[index + 1]!.startFrame * FRAME_SAMPLES;
    const speechEnd = Math.min(samples.length, run.endFrame * FRAME_SAMPLES);
    const speechStart = run.startFrame * FRAME_SAMPLES;
    return {
      start: Math.max(previousEnd, speechStart - padding),
      speechStart,
      speechEnd,
      end: Math.min(nextStart, samples.length, speechEnd + padding),
    };
  });
}

export function wavFromSamples(samples: Int16Array): Uint8Array<ArrayBuffer> {
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
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, dataBytes, true);
  new Int16Array(buffer, 44, samples.length).set(samples);
  return new Uint8Array(buffer);
}
