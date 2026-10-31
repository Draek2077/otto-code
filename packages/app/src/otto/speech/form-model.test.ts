import { describe, expect, it, vi } from "vitest";
import { saveSpeech, type SpeechSnapshot } from "@getpaseo/plugin/otto/speech";
import { openSpeechForm } from "./form-model";
import { speechDeferred, speechSnapshot } from "../../../test-speech";

function fixture() {
  const initial = speechSnapshot();
  const pending = speechDeferred<SpeechSnapshot>();
  const port = {
    read: vi.fn(async () => initial),
    save: vi.fn((_input: typeof saveSpeech.input._output) => pending.promise),
    retry: vi.fn(async () => initial),
    confirmReload: vi.fn(async () => true),
  };
  const form = openSpeechForm(initial, port);
  const edit = () =>
    form.edit((draft) => ({
      ...draft,
      voice: { ...draft.voice, tts: { ...draft.voice.tts, speed: 0.75 } },
    }));
  return { initial, pending, port, form, edit };
}
describe("speech settings form", () => {
  it("does not save or launch anything on construction or editing; submits the originating revision once", async () => {
    const { initial, pending, port, form, edit } = fixture();
    edit();
    expect(port.save).not.toHaveBeenCalled();
    const saving = form.save();
    await form.save();
    expect(port.save).toHaveBeenCalledTimes(1);
    expect(port.save.mock.calls[0]?.[0]).toMatchObject({
      expectedRevision: "revision-1",
      settings: { voice: { tts: { speed: 0.75 } } },
    });
    pending.resolve({ ...initial, revision: "revision-2", settings: form.getSnapshot().draft });
    await saving;
    expect(form.dirty()).toBe(false);
    expect(form.getSnapshot().origin.revision).toBe("revision-2");
  });
  it("retains a failed draft and key without automatically retrying or adopting a new revision", async () => {
    const { form, pending, port, edit } = fixture();
    edit();
    form.credential("tts", { kind: "replace", value: "new-fixture-key" });
    const saving = form.save();
    pending.reject(new Error("conflict"));
    await saving;
    await form.save();
    expect(port.save).toHaveBeenCalledTimes(1);
    expect(form.getSnapshot()).toMatchObject({
      blocked: true,
      draft: { voice: { tts: { speed: 0.75 } } },
      credentials: { tts: { kind: "replace", value: "new-fixture-key" } },
      origin: { revision: "revision-1" },
    });
  });
  it("requires explicit reload after a hidden write and ignores its late normalized acknowledgement", async () => {
    const { initial, form, pending, edit } = fixture();
    edit();
    const saving = form.save();
    form.setActive(false);
    form.setActive(true);
    pending.resolve({ ...initial, revision: "late" });
    await saving;
    expect(form.getSnapshot()).toMatchObject({
      blocked: true,
      origin: { revision: "revision-1" },
      draft: { voice: { tts: { speed: 0.75 } } },
    });
    await form.reload();
    expect(form.getSnapshot().blocked).toBe(false);
    expect(form.dirty()).toBe(false);
  });
  it("declining a reload keeps the dirty draft and serializes confirmation dialogs", async () => {
    const { form, port, edit } = fixture();
    edit();
    const confirmation = speechDeferred<boolean>();
    port.confirmReload.mockImplementation(() => confirmation.promise);
    const reload = form.reload();
    await form.reload();
    expect(port.confirmReload).toHaveBeenCalledTimes(1);
    confirmation.resolve(false);
    await reload;
    expect(port.read).not.toHaveBeenCalled();
    expect(form.dirty()).toBe(true);
  });
  it("refreshes readiness without rebasing drafts and blocks on peer config changes", async () => {
    const { form, port, initial, edit } = fixture();
    edit();
    port.read.mockResolvedValue({
      ...initial,
      readiness: { ...initial.readiness, downloading: true },
    });
    await form.refresh();
    expect(form.dirty()).toBe(true);
    expect(form.getSnapshot().origin.readiness.downloading).toBe(true);
    port.read.mockResolvedValue({ ...initial, revision: "peer" });
    await form.refresh();
    expect(form.getSnapshot().blocked).toBe(true);
    expect(form.getSnapshot().origin.revision).toBe("revision-1");
  });
  it("never interprets a blank replacement as key removal", async () => {
    const { form, port } = fixture();
    form.credential("stt", { kind: "replace", value: "" });
    await form.save();
    expect(port.save).not.toHaveBeenCalled();
    expect(form.getSnapshot().error).toContain("API key");
  });
  it("ignores a reload confirmation accepted after hiding and clears key drafts on close", async () => {
    const { form, port, edit } = fixture();
    edit();
    form.credential("stt", { kind: "replace", value: "fixture" });
    const confirmation = speechDeferred<boolean>();
    port.confirmReload.mockImplementation(() => confirmation.promise);
    const reload = form.reload();
    form.setActive(false);
    confirmation.resolve(true);
    await reload;
    expect(port.read).not.toHaveBeenCalled();
    form.close();
    expect(form.getSnapshot().credentials).toEqual({
      stt: { kind: "keep" },
      tts: { kind: "keep" },
    });
  });
});
