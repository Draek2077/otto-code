import { describe, expect, it } from "vitest";
import {
  LocalTtsModelIdSchema,
  getSherpaOnnxModelSpec,
} from "../../speech/providers/local/sherpa/model-catalog.js";
import {
  localTtsLayout,
  localTtsRequest,
  localTtsSpeaker,
  localTtsVoices,
} from "./model-catalog.js";

describe("Otto speech model continuity", () => {
  it.each(["kokoro-multi-lang-v1_0", "kokoro-int8-multi-lang-v1_0"])(
    "keeps %s selectable in the canonical runtime",
    (id) => {
      const model = LocalTtsModelIdSchema.parse(id);
      expect(getSherpaOnnxModelSpec(model).extractedDir).toBe(id);
      expect(localTtsVoices(model)).toHaveLength(53);
      expect(localTtsSpeaker(model, "af_heart")).toBe(3);
      expect(localTtsSpeaker(model, "zm_yunyang")).toBe(52);
    },
  );
  it("preserves the legacy speaker numbering and defaults", () => {
    expect(localTtsVoices("kokoro-en-v0_19")).toHaveLength(11);
    expect(localTtsSpeaker("kokoro-en-v0_19", "af_bella")).toBe(1);
    expect(localTtsRequest("kokoro-en-v0_19")).toEqual({ speakerId: 0, speed: 1 });
    expect(localTtsRequest("kokoro-multi-lang-v1_0")).toEqual({ speakerId: 3, speed: 1 });
  });
  it("loads the correct quantized file and lexicons", () => {
    expect(localTtsLayout("kokoro-int8-multi-lang-v1_0")).toEqual({
      modelFile: "model.int8.onnx",
      lexiconFiles: ["lexicon-us-en.txt", "lexicon-zh.txt"],
      defaultSpeakerId: 3,
    });
    expect(localTtsLayout("kokoro-en-v0_19").lexiconFiles).toEqual([]);
  });
  it.each([-1, 53, 1.5, NaN])(
    "rejects invalid speakers (%s) before native synthesis",
    (speaker) => {
      expect(() => localTtsRequest("kokoro-multi-lang-v1_0", speaker)).toThrow("speaker");
    },
  );
  it.each([0, Infinity, NaN, 4.1])(
    "rejects invalid speeds (%s) before native synthesis",
    (speed) => {
      expect(() => localTtsRequest("kokoro-en-v0_19", 0, speed)).toThrow("speed");
    },
  );
  it("never silently substitutes a voice from a different model", () => {
    expect(() => localTtsSpeaker("kokoro-en-v0_19", "af_heart")).toThrow("voice");
  });
});
