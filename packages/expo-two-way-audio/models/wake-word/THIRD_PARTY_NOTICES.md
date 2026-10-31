# Hey Otto wake-word model notices

The files in this directory are the runtime subset of
`sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01`, distributed by the
Sherpa-ONNX project under Apache License 2.0.

Android builds also package the official `sherpa-onnx-1.12.28.aar` runtime
from the same project. Its exact source, byte count, and SHA-256 checksum are
recorded in the manifest.

The model was trained on the GigaSpeech corpus. The official GigaSpeech
repository is also distributed under Apache License 2.0.

Sources and exact file checksums are recorded in
`packages/expo-two-way-audio/wake-word-model.json`. Otto includes only the
quantized encoder and joiner, decoder, tokens, and generated `Hey Otto`
keyword file needed at runtime. The complete Apache License 2.0 text is
installed beside this notice as `LICENSE-APACHE-2.0.txt`.

- Sherpa-ONNX: https://github.com/k2-fsa/sherpa-onnx
- GigaSpeech: https://github.com/SpeechColab/GigaSpeech
- Apache License 2.0: https://www.apache.org/licenses/LICENSE-2.0
