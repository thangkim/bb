import { describe, expect, it } from "vitest";
import {
  cleanTranscript,
  joinPieces,
  languageCode,
  parseInferenceResponse,
} from "./whisper-response.js";

describe("languageCode", () => {
  it("maps Whisper's language names to codes", () => {
    expect(languageCode("vietnamese")).toBe("vi");
    expect(languageCode("Russian")).toBe("ru");
    expect(languageCode("en")).toBe("en");
    expect(languageCode("klingon")).toBeNull();
  });
});

describe("parseInferenceResponse", () => {
  it("reports the detected language as a code", () => {
    expect(
      parseInferenceResponse(
        JSON.stringify({ text: " Привет", language: "russian" }),
      ),
    ).toEqual({ kind: "transcript", text: " Привет", detectedLanguage: "ru" });
  });

  it("surfaces whisper-server errors", () => {
    expect(
      parseInferenceResponse(JSON.stringify({ error: "bad audio" })),
    ).toEqual({
      kind: "error",
      message: "whisper-server: bad audio",
    });
  });

  it("rejects non-JSON bodies", () => {
    expect(parseInferenceResponse("<html>").kind).toBe("error");
  });
});

describe("cleanTranscript", () => {
  it("drops non-speech markers and whisper's line breaks", () => {
    expect(cleanTranscript(" [BLANK_AUDIO]\n Hello\n there. [MUSIC]")).toBe(
      "Hello there.",
    );
    expect(cleanTranscript(" when I say in BB\n.\n And then")).toBe(
      "when I say in BB. And then",
    );
  });
});

describe("joinPieces", () => {
  it("drops a period Whisper added where a same-language sentence continues", () => {
    expect(
      joinPieces([
        { text: " the model should be free.", language: "en" },
        { text: " and serve voice input best.", language: "en" },
        { text: " Tôi nói tiếng Việt.", language: "vi" },
        { text: " а потом по-русски.", language: "ru" },
      ]),
    ).toBe(
      "the model should be free and serve voice input best. Tôi nói tiếng Việt. а потом по-русски.",
    );
  });

  it("keeps ellipses and skips empty pieces", () => {
    expect(
      joinPieces([
        { text: "I want to...", language: "en" },
        { text: " [BLANK_AUDIO] ", language: "en" },
        { text: "install it", language: "en" },
      ]),
    ).toBe("I want to... install it");
  });
});
