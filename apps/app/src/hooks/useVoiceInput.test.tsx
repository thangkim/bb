// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { appToast } from "@/components/ui/app-toast";
import { useVoiceInput } from "./useVoiceInput";

vi.mock("@/components/ui/app-toast", () => ({
  appToast: { error: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/lib/audio-input-device-preference", () => ({
  useAudioInputDevicePreferenceValue: () => null,
  buildAudioInputConstraints: () => ({ audio: true }),
}));

class Recorder {
  static isTypeSupported = () => true;
  mimeType = "audio/webm";
  state = "inactive";
  onstart = () => {};
  ondataavailable = (_event: { data: Blob }) => {};
  onstop = async () => {};
  start() {
    this.state = "recording";
    this.onstart();
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable({ data: new Blob(["recorded audio"]) });
    return this.onstop();
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("MediaRecorder", Recorder);
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: vi
        .fn()
        .mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }),
    },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it.each([
  new Error("Upload failed"),
  new Error("Audio file exceeds the 20MB limit"),
])("keeps failed audio downloadable after unmount: %s", async (error) => {
  const transcribe = vi.fn().mockRejectedValue(error);
  const transcript = vi.fn();
  const { result, unmount } = renderHook(() =>
    useVoiceInput({
      onTranscribe: transcribe,
      onTranscript: transcript,
    }),
  );
  await act(() => result.current.start());
  vi.advanceTimersByTime(1500);
  await act(async () => result.current.stop());
  expect(result.current.state).toBe("error");
  expect(transcript).not.toHaveBeenCalled();
  const options = vi.mocked(appToast.error).mock.calls[0]?.[1];
  expect(options?.duration).toBe(Infinity);
  expect(options?.action?.label).toBe("Download recording");
  unmount();
  const createObjectURL = vi.fn(() => "blob:recording");
  const revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
  let downloadedName = "";
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
    function (this: HTMLAnchorElement) {
      downloadedName = this.download;
      expect(this.href).toBe("blob:recording");
      expect(this.isConnected).toBe(true);
    },
  );
  if (!options?.action) throw new Error("Missing download action");
  const button = render(
    <button onClick={options.action.onClick}>Download recording</button>,
  );
  fireEvent.click(button.getByRole("button"));
  expect(createObjectURL).toHaveBeenCalledWith(
    transcribe.mock.calls[0]?.[0].file,
  );
  expect(downloadedName).toBe("recording.webm");
  expect(revokeObjectURL).not.toHaveBeenCalled();
  vi.advanceTimersByTime(60_000);
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:recording");
});

it("does not offer a download after explicit cancellation", async () => {
  const { result } = renderHook(() =>
    useVoiceInput({
      onTranscribe: vi
        .fn()
        .mockRejectedValue(new DOMException("Cancelled", "AbortError")),
      onTranscript: vi.fn(),
    }),
  );
  await act(() => result.current.start());
  vi.advanceTimersByTime(1500);
  await act(async () => result.current.stop());
  expect(result.current.state).toBe("idle");
  expect(appToast.error).not.toHaveBeenCalled();
});

class ChunkingRecorder {
  static isTypeSupported = () => true;
  mimeType = "audio/webm";
  state = "inactive";
  timer: ReturnType<typeof setInterval> | null = null;
  onstart = () => {};
  ondataavailable = (_event: { data: Blob }) => {};
  onstop = async () => {};
  start(timesliceMs: number) {
    this.state = "recording";
    this.timer = setInterval(() => {
      this.ondataavailable({ data: new Blob(["chunk"]) });
    }, timesliceMs);
    this.onstart();
  }
  stop() {
    this.state = "inactive";
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.ondataavailable({ data: new Blob(["chunk"]) });
    return this.onstop();
  }
}

it("shows the words heard so far while the recording continues", async () => {
  vi.stubGlobal("MediaRecorder", ChunkingRecorder);
  const drafts = ["Привет", "Привет, это тест"];
  const onDraftTranscribe = vi.fn(
    async () => drafts.shift() ?? "Привет, это тест",
  );
  const { result } = renderHook(() =>
    useVoiceInput({
      onTranscribe: vi.fn().mockResolvedValue("Привет, это тест."),
      onTranscript: vi.fn(),
      onDraftTranscribe,
    }),
  );

  await act(() => result.current.start());
  expect(result.current.draftTranscript).toBe("");

  await act(async () => void (await vi.advanceTimersByTimeAsync(2_900)));
  expect(onDraftTranscribe).not.toHaveBeenCalled();

  await act(async () => void (await vi.advanceTimersByTimeAsync(100)));
  expect(onDraftTranscribe).toHaveBeenCalledTimes(1);
  expect(result.current.draftTranscript).toBe("Привет");

  await act(async () => void (await vi.advanceTimersByTimeAsync(4_200)));
  expect(onDraftTranscribe).toHaveBeenCalledTimes(2);
  expect(result.current.draftTranscript).toBe("Привет, это тест");

  const duringRecording = onDraftTranscribe.mock.calls.length;
  await act(async () => result.current.stop());
  await act(async () => void (await vi.advanceTimersByTimeAsync(10_000)));
  expect(onDraftTranscribe).toHaveBeenCalledTimes(duringRecording);
  expect(result.current.draftTranscript).toBe("");
});

it("keeps a failed draft silent and stops drafting after one failure", async () => {
  vi.stubGlobal("MediaRecorder", ChunkingRecorder);
  const onDraftTranscribe = vi
    .fn()
    .mockRejectedValue(new Error("Upload failed"));
  const { result } = renderHook(() =>
    useVoiceInput({
      onTranscribe: vi.fn().mockResolvedValue("done"),
      onTranscript: vi.fn(),
      onDraftTranscribe,
    }),
  );

  await act(() => result.current.start());
  await act(async () => void (await vi.advanceTimersByTimeAsync(20_000)));

  expect(onDraftTranscribe).toHaveBeenCalledTimes(1);
  expect(appToast.error).not.toHaveBeenCalled();
  expect(result.current.state).toBe("recording");
  expect(result.current.draftTranscript).toBe("");
});

it("lets an in-flight preview finish before sending the final request", async () => {
  vi.stubGlobal("MediaRecorder", ChunkingRecorder);
  let finishDraft: ((text: string) => void) | undefined;
  let draftSignal: AbortSignal | undefined;
  const onDraftTranscribe = vi.fn(
    ({ signal }: { signal?: AbortSignal }) =>
      new Promise<string>((resolve) => {
        draftSignal = signal;
        finishDraft = resolve;
      }),
  );
  const onTranscribe = vi.fn().mockResolvedValue("Final words");
  const onTranscript = vi.fn();
  const { result } = renderHook(() =>
    useVoiceInput({ onTranscribe, onTranscript, onDraftTranscribe }),
  );

  await act(() => result.current.start());
  await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)));
  expect(onDraftTranscribe).toHaveBeenCalledTimes(1);

  await act(async () => void result.current.stop());
  expect(result.current.state).toBe("transcribing");
  expect(draftSignal?.aborted).toBe(false);
  expect(onTranscribe).not.toHaveBeenCalled();

  await act(async () => finishDraft?.("Final"));
  expect(onTranscribe).toHaveBeenCalledOnce();
  expect(onTranscript).toHaveBeenCalledWith("Final words");
  expect(result.current.state).toBe("idle");
});

it("inserts the live preview when the final request fails", async () => {
  vi.stubGlobal("MediaRecorder", ChunkingRecorder);
  const onTranscript = vi.fn();
  const { result } = renderHook(() =>
    useVoiceInput({
      onTranscribe: vi
        .fn()
        .mockRejectedValue(new Error("HTTP 403: Cloudflare challenge")),
      onTranscript,
      onDraftTranscribe: vi.fn(async () => "Words heard so far"),
    }),
  );

  await act(() => result.current.start());
  await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)));
  expect(result.current.draftTranscript).toBe("Words heard so far");

  await act(async () => void (await result.current.stop()));

  expect(onTranscript).toHaveBeenCalledWith("Words heard so far");
  expect(result.current.state).toBe("idle");
  expect(result.current.draftTranscript).toBe("");
  expect(appToast.error).not.toHaveBeenCalled();
  const [title, options] = vi.mocked(appToast.warning).mock.calls[0] ?? [];
  expect(title).toBe("Voice input used the live preview");
  expect(options?.action?.label).toBe("Download recording");
});

it("aborts an in-flight preview when the recording is cancelled", async () => {
  vi.stubGlobal("MediaRecorder", ChunkingRecorder);
  let draftSignal: AbortSignal | undefined;
  const onTranscribe = vi.fn();
  const { result } = renderHook(() =>
    useVoiceInput({
      onTranscribe,
      onTranscript: vi.fn(),
      onDraftTranscribe: ({ signal }) => {
        draftSignal = signal;
        return new Promise<string>(() => {});
      },
    }),
  );

  await act(() => result.current.start());
  await act(async () => void (await vi.advanceTimersByTimeAsync(3_000)));
  await act(async () => void result.current.cancel());

  expect(draftSignal?.aborted).toBe(true);
  expect(onTranscribe).not.toHaveBeenCalled();
  expect(result.current.state).toBe("idle");
});
