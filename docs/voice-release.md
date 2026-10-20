# Slow voice recording release

The `20261020-voice-v2` release replaces the vocabulary recordings with
synthetic speech based on the site owner's supplied voice sample. The owner
reviewed a 20-item preview, requested slower speech and clearer single
characters, and approved the revised preview before full production.
Those 20 approved MP3 files are retained byte for byte.

The vocabulary still contains 5,003 entries. It uses 5,001 distinct recording
paths: the two entries for 等 share their reading, as do the two entries for 对.
The six pairs with different readings retain separate recordings. Eight
additional legacy headword URLs use copies of the first listed reading;
the study interface always resolves the full vocabulary entry.

## Generation

Speech is generated locally with `sherpa-onnx==1.13.8`, ZipVoice Distill
Chinese/English, and the Vocos 24 kHz vocoder. Explicit initials, finals, and
tones are derived from each entry's pinyin. This avoids choosing a polyphonic
character's default reading when the entry specifies a different one.

The reference is the owner's uploaded sample. The original sample, extracted
reference audio, model files, and generation work directory are not included
in this repository or the website. Generation uses excerpts from several
sentences in that same sample. The release manifest records each recording's
reference segment and SHA-256 without publishing the source recording.

The approved pacing uses a normal synthesis speed of 0.9 followed by FFmpeg
`atempo` to preserve pitch while slowing words to an effective 0.75 and isolated
characters to 0.65. The clips have 120 ms leading and 220 ms trailing silence.
Volume is balanced with headroom, and delivery is mono 24 kHz MP3 at 128 kbit/s.
The application's existing 0.5–1.5 playback speed setting remains available.

Unclear takes are regenerated individually with the full-precision model.
Some replacements use more inference steps, stronger text conditioning, or a
different native synthesis pace before conversion to the same final pace.
Where a neutral-tone model token produces an unclear
syllable, the lexical syllable is generated and its final pitch and duration
are adjusted with Praat PSOLA to realize the neutral tone. The release
manifest records these exceptions per recording.

Some isolated characters also receive a PSOLA pitch-contour correction to
make the teaching tone clearer, followed by another content and contour
check. A few very short vowels are lengthened to make the contour audible.
These corrections are recorded as
`tone_processing`; they are not applied to the approved preview recordings.

Neutral-tone 过 and 得 retain the approved short contexts 去过 and 说得好.
次 and 血 use 一次 and 血液 to clarify the target readings `cì` and `xuè`.
呆, 脏, and 刺 use 发呆, 很脏, and 刺痛 to make their consonants clearer.
熬, 甭, and 搀 use 熬夜, 甭管, and 搀扶 for the same reason.
窜, 捏, 拧, and 趴 use 逃窜, 捏紧, 拧干, and 趴下.
The interface labels all fourteen examples beside their headwords.
光滑 is corrected to `guānghuá` in both the
vocabulary and the rebuild overrides.

陈旧, 机灵, 辛勤, and 着手 use separately articulated syllables with a short
pause to clarify their consonants and vowel endings. 机灵 then receives its
neutral final tone. Their component sources and processing are recorded in
the release manifest.

Official model artifacts:

| Artifact | SHA-256 |
| --- | --- |
| [ZipVoice Distill int8](https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/sherpa-onnx-zipvoice-distill-int8-zh-en-emilia.tar.bz2) | `77219c8b40f4ee8d73a7f902305ff6c1128ef9b54461c41b4ca6ed890b6c2803` |
| [ZipVoice Distill fp32](https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/sherpa-onnx-zipvoice-distill-fp32-zh-en-emilia.tar.bz2) | `3b6729d03bf4ba64deeec113048bdbbe55dbc30580b609be76342e0099fd23a8` |
| [Vocos 24 kHz](https://github.com/k2-fsa/sherpa-onnx/releases/download/vocoder-models/vocos_24khz.onnx) | `bcb3b970e384161c4d634f0bb9e999ff1c471b34c9bc0b1049a5014065ed3cc0` |

## Release checks

`data/audio-release.json` records the vocabulary coverage, per-file hashes,
duration, reading, and approved-preview provenance. This file is an audit
artifact and is not downloaded by the study page.

```sh
npm test
node tools/audit_pronunciation.js
python3 tools/audit_voice_release.py --decode --report /tmp/hsk-voice-audit.json
# Verify the published bytes as well:
python3 tools/audit_voice_release.py --decode --base-url https://tcll1988.github.io/HSK/
```

The voice audit requires Python 3 and FFmpeg. It checks every deployed MP3,
including legacy copies, against its checksum and decodes every recording.
The pronunciation audit checks all vocabulary paths and distinct readings.
Generation also screens the transcribed content, signal levels, and isolated
tone contours. A second Chinese CTC recognizer checks ambiguous takes;
the recording manifest identifies cases accepted through that
independent check. Speech recognition and pitch measurements are screening tools;
they do not constitute a native-speaker listening review of every recording.

Run all three browser suites described in the main README against the release.
They exercise real audio playback as well as lookup, practice, saved progress,
review scheduling, backups, mobile layouts, and touch/keyboard interaction.
Use a fresh output directory and keep `HSK_LEARNING_CASE` unset for a full run.

`HSK.audioSrc(entry)` retains the stable file path used by import and audit
tools. `HSK.audioPlaybackSrc(entry)` adds the recording release version for
browser playback, so cached recordings from the previous voice are not reused.
The entry-specific paths for differing readings remain distinct.

The `Verify published HSK` GitHub Actions workflow waits for the deployed
HTML, scripts, styles, and release manifest to match the checked-out commit.
It then downloads and checks every published recording and runs all 25
browser cases against the real website. Unit-test results, audio audit,
browser logs, and screenshots are retained together as a workflow artifact.
