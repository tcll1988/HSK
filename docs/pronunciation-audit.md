# Pronunciation corrections and asset provenance

This update audits the eight repeated headwords in the 5,003-row vocabulary.
Six have different readings and must not share a recording. 等 and 对 retain
their shared recordings because their respective readings are identical.
IDs, level assignments, and all six level totals are unchanged.

| ID | Word | Reading | Change |
| --- | --- | --- | --- |
| 1000 / 3039 | 尽量 | jìnliàng / jǐnliàng | Separate pronunciation assets |
| 2892 / 4745 | 过 | guo / guò | Distinguish neutral grammatical particle from verb |
| 3903 / 4727 | 得 | děi / de | Separate assets; remove the dé gloss “得る” from the děi entry |
| 3998 / 4746 | 还 | huán / hái | Separate pronunciation assets |
| 4369 / 4694 | 只 | zhī / zhǐ | Separate pronunciation assets |
| 4689 / 4716 | 长 | zhǎng / cháng | Separate pronunciation assets |
| 4282 | 行 | háng | Correct xíng to the reading for the row counter |
| 4459 | 地 | dì | Correct de to the reading for land/ground |

All 14 rows now carry an explicit `audio` field. `HSK.prepareVocab` preserves
it, and `HSK.audioSrc(entry)` resolves it before considering the legacy
headword path. Passing a bare string still resolves the old file for backward
compatibility; the learning UI must pass the full entry to select a reading.
The reviewed fields are also kept in `tools/pronunciation-overrides.json`.
`node tools/build_vocab.js` reapplies this file after importing the original
workbook data, so rebuilding does not lose corrections or pronunciation paths.

## Generated clips

The 14 `audio/NN/entry-ID.mp3` clips are **synthetic speech**, generated locally
using the public Mandarin model `vits-icefall-zh-aishell3` distributed by
[sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx). The generator supplies the
initial, final, and tone explicitly through a custom lexicon, preventing an
automatic text reader from guessing the wrong reading of a polyphonic word.
Neutral readings explicitly use `uo5` and `e5`; they are not renamed tone-four
or tone-two clips. These two particles use short contexts, **去过** and **说得好**,
because a neutral tone depends on its neighboring syllables (and this model's
isolated `de` output failed the signal-amplitude check). Their `audioText`
metadata tells the UI which example is spoken. The other 12 clips pronounce
the headword alone. The model's existing speaker ID 66 is used throughout.

Source and build information:

- Model: <https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-icefall-zh-aishell3.tar.bz2>
- Model documentation: <https://github.com/k2-fsa/sherpa/blob/master/docs/source/onnx/tts/pretrained_models/vits.rst>
- Model trained with [icefall](https://github.com/k2-fsa/icefall), Apache-2.0,
  using [AISHELL-3](https://www.openslr.org/93/), distributed as Apache-2.0.
- Runtime: `sherpa-onnx==1.13.8` (Apache-2.0), `soundfile==0.14.0`, and FFmpeg.
- Archive SHA-256: `ab468db3a3308cdd861495e0db2f25d79418a0c00639f74944c7cdf5dd8c6ec1`.
- `model.onnx` SHA-256: `5511d651b7840c0a93a6bbfd4afd070a2c7f39ca1ec3ff2ecd73191519bbb852`.
- Explicit phonemes and generation settings: `tools/generate_pronunciation_audio.py`.
- Processing: peak normalization, 80 ms leading / 160 ms trailing silence,
  mono MP3 at 48 kbps. The 8 kHz model output is resampled to 24 kHz for encoding;
  resampling does not imply higher source quality.

No model, runtime package, third-party source recording, or service credential
is shipped to the website. Only the generated MP3 files are deployed.

To regenerate after downloading and extracting the documented model:

```sh
python3 -m venv /tmp/hsk-pronunciation-build
/tmp/hsk-pronunciation-build/bin/pip install sherpa-onnx==1.13.8 soundfile==0.14.0
/tmp/hsk-pronunciation-build/bin/python tools/generate_pronunciation_audio.py /path/to/vits-icefall-zh-aishell3
node tools/audit_pronunciation.js
```

## Validation scope

The audit verifies that all entries have files, all differing readings have
separate paths and audio bytes, the selected phonemes exist in the pinned
model, and the generated clips decode as nonempty audio. It does **not** claim
that every original recording has been listened to or that all 5,003 glosses
have received a complete editorial review. Native-speaker listening review of
the new synthetic clips, especially neutral tones and prosody, remains useful.
