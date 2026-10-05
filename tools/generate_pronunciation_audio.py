#!/usr/bin/env python3
"""Build the 14 reading-specific clips; see docs/pronunciation-audit.md.

Requires sherpa-onnx==1.13.8, soundfile==0.14.0, numpy, and ffmpeg.
The model and generation dependencies are build-time tools, never site assets.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

MODEL_SHA256 = "5511d651b7840c0a93a6bbfd4afd070a2c7f39ca1ec3ff2ecd73191519bbb852"
READINGS = [
    (1000, "尽量", "jìnliàng", "j in4 #0 l iang4 #0"),
    (2892, "过", "guo", "q v4 #0 g uo5 #0"),  # 去过: neutral syllable in context
    (3039, "尽量", "jǐnliàng", "j in3 #0 l iang4 #0"),
    (3903, "得", "děi", "d ei3 #0"),
    (3998, "还", "huán", "h uan2 #0"),
    (4282, "行", "háng", "h ang2 #0"),
    (4369, "只", "zhī", "zh iii1 #0"),
    (4459, "地", "dì", "d i4 #0"),
    (4689, "长", "zhǎng", "zh ang3 #0"),
    (4694, "只", "zhǐ", "zh iii3 #0"),
    (4716, "长", "cháng", "ch ang2 #0"),
    (4727, "得", "de", "sh uo1 #0 d e5 #0 h ao3 #0"),  # 说得好
    (4745, "过", "guò", "g uo4 #0"),
    (4746, "还", "hái", "h ai2 #0"),
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("model_dir", type=Path)
    args = parser.parse_args()
    import numpy as np
    import sherpa_onnx
    import soundfile

    model = args.model_dir / "model.onnx"
    if hashlib.sha256(model.read_bytes()).hexdigest() != MODEL_SHA256:
        raise ValueError("Unexpected model: use the documented vits-icefall-zh-aishell3 release")
    tokens = {line.split()[0] for line in (args.model_dir / "tokens.txt").read_text().splitlines()}
    root = Path(__file__).resolve().parent.parent
    vocab_text = (root / "data/vocab.js").read_text()
    vocab = {e["id"]: e for e in json.loads(vocab_text[vocab_text.index("["):].rstrip().rstrip(";"))}

    with tempfile.TemporaryDirectory(prefix="hsk-pronunciation-") as directory:
        work = Path(directory)
        # Unique CJK aliases bypass the model's automatic homograph selection.
        # These aliases are internal only; explicit initials/finals/tones supply
        # every sound. In particular, neutral tones use e5/uo5, not e2/uo4.
        aliases = [chr(0x7532 + i) for i in range(len(READINGS))]
        lexicon = work / "lexicon.txt"
        lexicon.write_text("".join(f"{alias} {phones}\n" for alias, (_, _, _, phones) in zip(aliases, READINGS)))
        for _, _, _, phones in READINGS:
            if not set(phones.split()).issubset(tokens):
                raise ValueError("A requested phoneme is absent from the model")
        config = sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(
            vits=sherpa_onnx.OfflineTtsVitsModelConfig(
                model=str(model), lexicon=str(lexicon), tokens=str(args.model_dir / "tokens.txt"),
                noise_scale=0.3, noise_scale_w=0.3,
            ), num_threads=2,
        ))
        if not config.validate():
            raise ValueError("Invalid synthesis configuration")
        tts = sherpa_onnx.OfflineTts(config)
        for alias, (entry_id, hanzi, pinyin, phones) in zip(aliases, READINGS):
            entry = vocab[entry_id]
            if (entry["hanzi"], entry["pinyin"]) != (hanzi, pinyin):
                raise ValueError(f"Review the pronunciation mapping for {entry_id}")
            audio = tts.generate(alias, sid=66, speed=0.9)
            samples = np.asarray(audio.samples)
            peak = float(np.max(np.abs(samples)))
            if not np.isfinite(samples).all() or peak < 0.01 or len(samples) / audio.sample_rate < 0.1:
                raise ValueError(f"Empty or invalid audio for {entry_id}")
            samples = samples * (0.85 / peak)
            samples = np.pad(samples, (int(audio.sample_rate * .08), int(audio.sample_rate * .16)))
            wav = work / f"{entry_id}.wav"
            soundfile.write(wav, samples, audio.sample_rate, subtype="PCM_16")
            destination = root / entry["audio"]
            destination.parent.mkdir(exist_ok=True)
            subprocess.run([
                "ffmpeg", "-v", "error", "-y", "-i", str(wav), "-ar", "24000", "-ac", "1",
                "-codec:a", "libmp3lame", "-b:a", "48k",
                "-metadata", f"title={entry.get('audioText', hanzi)} ({pinyin})",
                "-metadata", "comment=Generated with sherpa-onnx vits-icefall-zh-aishell3; explicit phonemes; see docs/pronunciation-audit.md",
                str(destination),
            ], check=True)
            print(f"{entry_id}: {hanzi} {pinyin} [{phones}] -> {entry['audio']}")


if __name__ == "__main__":
    main()
