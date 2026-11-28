#!/usr/bin/env python3
"""Merge per-set Japanese explanations (exam/data/explanations/<SET_ID>.json)
into exam/data/sets/<SET_ID>.js and bump manifest.js version."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "exam/data"
SETS_DIR = DATA_DIR / "sets"
EXP_DIR = DATA_DIR / "explanations"
MANIFEST_PATH = DATA_DIR / "manifest.js"
VERSION = "20261126-v2"
KANA_RE = re.compile(r"[\u3040-\u309f\u30a0-\u30ff]")


def main():
    set_files = sorted(SETS_DIR.glob("*.js"))
    merged_sets = 0
    merged_qs = 0
    missing = []

    for sf in set_files:
        sid = sf.stem
        ef = EXP_DIR / f"{sid}.json"
        if not ef.exists():
            missing.append(sid)
            continue
        raw = sf.read_text(encoding="utf-8")
        data = json.loads(raw.split("] =", 1)[1].strip().rstrip(";"))
        exp_map = json.loads(ef.read_text(encoding="utf-8"))

        for q in data["questions"]:
            k = str(q["n"])
            txt = (exp_map.get(k) or "").strip()
            if not txt or not KANA_RE.search(txt):
                raise ValueError(f"{sid} Q{k}: missing or invalid explanationJa")
            q["explanationJa"] = txt
            merged_qs += 1

        js_body = (
            "window.HSK_EXAM_SETS = window.HSK_EXAM_SETS || {};\n"
            f"window.HSK_EXAM_SETS[{json.dumps(sid)}] = "
            + json.dumps(data, ensure_ascii=False, separators=(",", ":"))
            + ";\n"
        )
        sf.write_text(js_body, encoding="utf-8")
        merged_sets += 1

    if missing:
        raise SystemExit(f"Missing explanation files ({len(missing)}): {missing}")

    # Update manifest version for cache busting
    m_raw = MANIFEST_PATH.read_text(encoding="utf-8")
    m_data = json.loads(m_raw.split("=", 1)[1].strip().rstrip(";"))
    m_data["version"] = VERSION
    MANIFEST_PATH.write_text(
        "window.HSK_EXAM_MANIFEST = "
        + json.dumps(m_data, ensure_ascii=False, indent=2)
        + ";\n",
        encoding="utf-8",
    )
    print(f"Merged Japanese explanations into {merged_sets} sets ({merged_qs} questions), manifest version={VERSION}.")


if __name__ == "__main__":
    main()
