"""Real audio decoder fixtures for both native capture formats."""

import io
import sys
import unittest
import wave
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from zoom_recorder import batch


class AudioTests(unittest.TestCase):
    def fixture(self, samples, rate, format_, subtype):
        buffer = io.BytesIO()
        sf.write(buffer, samples, rate, format=format_, subtype=subtype)
        buffer.seek(0)
        return buffer

    def test_windows_float_extensible_stereo_is_decoded_and_averaged(self):
        samples = np.array([[0.5, 0.0], [0.0, -0.5], [0.25, 0.75]], dtype=np.float32)
        buffer = self.fixture(samples, 48000, "WAVEX", "FLOAT")
        with self.assertRaises(wave.Error):
            wave.open(buffer, "rb")
        buffer.seek(0)
        decoded, rate = batch.load_audio(buffer)
        self.assertEqual(rate, 48000)
        self.assertEqual(decoded.dtype, np.float32)
        np.testing.assert_allclose(decoded, [0.25, -0.25, 0.5])

    def test_linux_and_microphone_pcm_mono_are_preserved(self):
        samples = np.array([0.5, -0.5, 0.25], dtype=np.float32)
        buffer = self.fixture(samples, 16000, "WAV", "PCM_16")
        decoded, rate = batch.load_audio(buffer)
        self.assertEqual(rate, 16000)
        self.assertEqual(decoded.dtype, np.float32)
        np.testing.assert_allclose(decoded, samples, atol=1 / 32768)

    def test_duration_works_for_native_windows_format(self):
        buffer = self.fixture(np.zeros((4800, 2), dtype=np.float32), 48000, "WAVEX", "FLOAT")
        self.assertAlmostEqual(batch.wav_seconds(buffer), 0.1)

    def test_unreadable_audio_is_reported_by_decoder(self):
        with self.assertRaises(sf.LibsndfileError):
            batch.load_audio(io.BytesIO(b"invalid audio"))

    def test_transcription_receives_mono_samples_at_native_rate(self):
        buffer = self.fixture(np.array([[0.5, 0.0], [0.0, -0.5]], dtype=np.float32),
                              48000, "WAVEX", "FLOAT")
        decoded, rate = batch.load_audio(buffer)
        recognizer = MagicMock()
        recognizer.recognize.return_value = []
        cfg = {"model": "test", "label_me": "Me", "label_them": "Them",
               "group_gap_seconds": 1, "delete_audio_after_transcribe": False}
        manifest = {"started": "test", "parts": [{"track": "them", "file": "them.wav",
                                                    "offset": 0, "bytes": 2000}]}
        with patch.object(batch.config, "load", return_value=cfg), \
                patch.object(batch.recorder, "read_manifest", return_value=manifest), \
                patch.object(batch.engine, "load_segmenting_asr", return_value=recognizer), \
                patch.object(batch, "wav_seconds", return_value=1), \
                patch.object(batch, "load_audio", return_value=(decoded, rate)):
            batch.transcribe_session(MagicMock(), log=MagicMock())
        samples = recognizer.recognize.call_args.args[0]
        self.assertEqual(samples.dtype, np.float32)
        np.testing.assert_allclose(samples, [0.25, -0.25])
        self.assertEqual(recognizer.recognize.call_args.kwargs["sample_rate"], 48000)


if __name__ == "__main__":
    unittest.main()
