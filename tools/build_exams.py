#!/usr/bin/env python3
"""Build structured HSK 1-6 past exam data, cropped images, and compact MP3 audio.

Reads raw exam sets from HSK1_按套下载 .. HSK6_按套下载 (if present) and generates:
  - exam/data/manifest.js
  - exam/data/sets/<SET_ID>.js
  - exam/img/<SET_ID>/*.jpg
  - exam/audio/<SET_ID>.mp3

Run with --skip-audio to quickly rebuild/validate question data and images.
"""

import argparse
import concurrent.futures
import json
import os
import re
import subprocess
import tempfile
import zipfile
from collections import Counter
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parents[1]
EXAM_DIR = ROOT / "exam"
DATA_DIR = EXAM_DIR / "data"
SETS_DIR = DATA_DIR / "sets"
EXPLANATIONS_DIR = DATA_DIR / "explanations"
IMG_DIR = EXAM_DIR / "img"
AUDIO_DIR = EXAM_DIR / "audio"

VERSION = "20261126-v2"

# Official blueprint per HSK level
LEVEL_SPECS = {
    1: {
        "total": 40,
        "duration": 40,
        "sections": [
            {
                "key": "listening", "titleZh": "听力", "titleJa": "リスニング", "minutes": 15,
                "parts": [
                    (1, 1, 5, "tf_img", "音声を聞いて、写真の内容と合っていれば「√」、違っていれば「×」を選びます。"),
                    (2, 6, 10, "mc_img3", "音声を聞いて、内容に合う写真を A・B・C から選びます。"),
                    (3, 11, 15, "match_img", "会話を聞いて、内容に合う写真を A〜F から選びます。"),
                    (4, 16, 20, "mc3", "音声と質問を聞いて、正しい答えを A・B・C から選びます。"),
                ],
            },
            {
                "key": "reading", "titleZh": "阅读", "titleJa": "リーディング", "minutes": 17,
                "parts": [
                    (1, 21, 25, "tf_img_word", "写真と単語を見て、合っていれば「√」、違っていれば「×」を選びます。"),
                    (2, 26, 30, "match_img", "文を読んで、内容に合う写真を A〜F から選びます。"),
                    (3, 31, 35, "match_text", "質問文を読んで、最も適切な返答を A〜F から選びます。"),
                    (4, 36, 40, "match_word", "文の（　）に入る最も適切な語句を A〜F から選びます。"),
                ],
            },
        ],
    },
    2: {
        "total": 60,
        "duration": 55,
        "sections": [
            {
                "key": "listening", "titleZh": "听力", "titleJa": "リスニング", "minutes": 25,
                "parts": [
                    (1, 1, 10, "tf_img", "音声を聞いて、写真の内容と合っていれば「√」、違っていれば「×」を選びます。"),
                    (2, 11, 20, "match_img_2g", "会話を聞いて、内容に合う写真を A〜F（後半は A〜E）から選びます。"),
                    (3, 21, 30, "mc3", "短い会話と質問を聞いて、正しい答えを A・B・C から選びます。"),
                    (4, 31, 35, "mc3", "やや長い会話と質問を聞いて、正しい答えを A・B・C から選びます。"),
                ],
            },
            {
                "key": "reading", "titleZh": "阅读", "titleJa": "リーディング", "minutes": 22,
                "parts": [
                    (1, 36, 40, "match_img", "文を読んで、内容に合う写真を A〜F から選びます。"),
                    (2, 41, 45, "match_word", "文の（　）に入る最も適切な語句を A〜F から選びます。"),
                    (3, 46, 50, "tf_passage", "上の文を読み、★の文が内容と合っていれば「√」、違っていれば「×」を選びます。"),
                    (4, 51, 60, "match_text_2g", "文を読んで、関連する文を A〜F（後半は A〜E）から選びます。"),
                ],
            },
        ],
    },
    3: {
        "total": 80,
        "duration": 90,
        "sections": [
            {
                "key": "listening", "titleZh": "听力", "titleJa": "リスニング", "minutes": 35,
                "parts": [
                    (1, 1, 10, "match_img_2g", "会話を聞いて、内容に合う写真を A〜F（後半は A〜E）から選びます。"),
                    (2, 11, 20, "tf_listen", "音声を聞いて、★の文が内容と合っていれば「√」、違っていれば「×」を選びます。"),
                    (3, 21, 30, "mc3", "短い会話と質問を聞いて、正しい答えを A・B・C から選びます。"),
                    (4, 31, 40, "mc3", "やや長い会話と質問を聞いて、正しい答えを A・B・C から選びます。"),
                ],
            },
            {
                "key": "reading", "titleZh": "阅读", "titleJa": "リーディング", "minutes": 30,
                "parts": [
                    (1, 41, 50, "match_text_2g", "前後の文がつながるように、対応する文を A〜F（後半は A〜E）から選びます。"),
                    (2, 51, 60, "match_word_2g", "文や会話の（　）に入る最も適切な語句を A〜F から選びます。"),
                    (3, 61, 70, "mc_passage3", "短い文章を読んで、★の質問に対する正しい答えを A・B・C から選びます。"),
                ],
            },
            {
                "key": "writing", "titleZh": "书写", "titleJa": "ライティング", "minutes": 15,
                "parts": [
                    (1, 71, 75, "scramble", "与えられた語句を並べ替えて、正しい中国語の文を作ります。"),
                    (2, 76, 80, "char_input", "文脈とピンインを手がかりに、（　）に入る漢字1字を入力します。"),
                ],
            },
        ],
    },
    4: {
        "total": 100,
        "duration": 105,
        "sections": [
            {
                "key": "listening", "titleZh": "听力", "titleJa": "リスニング", "minutes": 30,
                "parts": [
                    (1, 1, 10, "tf_listen", "短い話を聞いて、★の文が内容と合っていれば「√」、違っていれば「×」を選びます。"),
                    (2, 11, 25, "mc4", "短い会話と質問を聞いて、正しい答えを A〜D から選びます。"),
                    (3, 26, 45, "mc4", "会話や短い話を聞いて、正しい答えを A〜D から選びます。"),
                ],
            },
            {
                "key": "reading", "titleZh": "阅读", "titleJa": "リーディング", "minutes": 40,
                "parts": [
                    (1, 46, 55, "match_word_2g", "文や会話の（　）に入る最も適切な語句を A〜F から選びます。"),
                    (2, 56, 65, "order", "A・B・C の3つの文を最も自然な順序に並べます。"),
                    (3, 66, 85, "mc_passage4", "文章を読んで、★の質問に対する正しい答えを A〜D から選びます。"),
                ],
            },
            {
                "key": "writing", "titleZh": "书写", "titleJa": "ライティング", "minutes": 25,
                "parts": [
                    (1, 86, 95, "scramble", "与えられた語句を並べ替えて、正しい中国語の文を作ります。"),
                    (2, 96, 100, "essay_pic_word", "写真を見て、指定された語句を使って中国語の文を作ります。"),
                ],
            },
        ],
    },
    5: {
        "total": 100,
        "duration": 125,
        "sections": [
            {
                "key": "listening", "titleZh": "听力", "titleJa": "リスニング", "minutes": 30,
                "parts": [
                    (1, 1, 20, "mc4_2col", "短い会話と質問を聞いて、正しい答えを A〜D から選びます。"),
                    (2, 21, 45, "mc4_2col", "会話やまとまった話を聞いて、正しい答えを A〜D から選びます。"),
                ],
            },
            {
                "key": "reading", "titleZh": "阅读", "titleJa": "リーディング", "minutes": 45,
                "parts": [
                    (1, 46, 60, "cloze_mc4", "文章を読み、各空欄に入る最も適切な語句や文を A〜D から選びます。"),
                    (2, 61, 70, "mc_consistent4", "段落を読み、内容と一致するものを A〜D から選びます。"),
                    (3, 71, 90, "long_reading4", "長文を読み、各設問に対する正しい答えを A〜D から選びます。"),
                ],
            },
            {
                "key": "writing", "titleZh": "书写", "titleJa": "ライティング", "minutes": 40,
                "parts": [
                    (1, 91, 98, "scramble", "与えられた語句を並べ替えて、正しい中国語の文を作ります。"),
                    (2, 99, 100, "essay_hsk5", "指定語句または写真にもとづいて、80字前後の短い文章を書きます。"),
                ],
            },
        ],
    },
    6: {
        "total": 101,
        "duration": 140,
        "sections": [
            {
                "key": "listening", "titleZh": "听力", "titleJa": "リスニング", "minutes": 35,
                "parts": [
                    (1, 1, 15, "mc4_2col", "短い話を聞いて、内容と一致するものを A〜D から選びます。"),
                    (2, 16, 30, "mc4_2col", "インタビューを聞いて、各設問の正しい答えを A〜D から選びます。"),
                    (3, 31, 50, "mc4_2col", "まとまった話を聞いて、各設問の正しい答えを A〜D から選びます。"),
                ],
            },
            {
                "key": "reading", "titleZh": "阅读", "titleJa": "リーディング", "minutes": 50,
                "parts": [
                    (1, 51, 60, "mc_error4", "A〜D の文から、文法・表現に誤り（語病）があるものを1つ選びます。"),
                    (2, 61, 70, "mc_fillmulti4", "文脈に合う語句の組み合わせを A〜D から選びます。"),
                    (3, 71, 80, "match_sentence_2g", "長文の空欄（71）〜（80）に入る文を A〜E から選びます。"),
                    (4, 81, 100, "long_reading4", "長文を読み、各設問に対する正しい答えを A〜D から選びます。"),
                ],
            },
            {
                "key": "writing", "titleZh": "书写", "titleJa": "ライティング", "minutes": 45,
                "parts": [
                    (1, 101, 101, "summary_hsk6", "10分間で物語文を読み、その後本文を見ずに400字前後の要約文（標題つき）を書きます。"),
                ],
            },
        ],
    },
}

# SimSun / GBK truncated CMap repair tables
SIMSUN_PUNCT = {
    0x00fc: 0x2014, 0x00fe: 0x2018, 0x00ff: 0x2019, 0x0100: 0x201c,
    0x0101: 0x201d, 0x0102: 0x2026, 0x0107: 0x2103, 0x011a: 0x221a,
    0x011d: 0x00d7, 0x0169: 0x2605, 0x01c2: 0x3000, 0x01c3: 0x3001,
    0x01c4: 0x3002, 0x01c9: 0x300a, 0x01ca: 0x300b, 0x01cd: 0x300e,
    0x01ce: 0x300f, 0x01cf: 0x3010, 0x01d0: 0x3011, 0x01d3: 0x3014,
    0x01d4: 0x3015, 0x01d5: 0x3016, 0x01d6: 0x3017,
}
for _gid in range(0x02bd, 0x031b):
    SIMSUN_PUNCT[_gid] = _gid + 0xfc44

CYRILLIC_TO_LATIN = str.maketrans({
    "А": "A", "В": "B", "С": "C", "Е": "E", "К": "K", "М": "M",
    "Н": "H", "О": "O", "Р": "P", "Т": "T", "У": "Y", "Х": "X",
    "а": "a", "в": "b", "с": "c", "е": "e", "о": "o", "р": "p", "х": "x",
    "ǃ": "、", "Ǆ": "。", "˖": "：", "ː": "：", "˄": "（", "˅": "）",
    "δ": "（", "ε": "）",
})


def load_vocab_words():
    """Load headwords from data/vocab.js for HSK5 keyword segmentation fallback."""
    vocab_js = (ROOT / "data/vocab.js").read_text(encoding="utf-8")
    m = re.search(r"window\.HSK_VOCAB\s*=\s*(\[.*\])\s*;?\s*$", vocab_js, re.S)
    if not m:
        return set()
    entries = json.loads(m.group(1))
    return {e["hanzi"] for e in entries if e.get("hanzi")}


VOCAB_WORDS = load_vocab_words()


def repair_pdf_cmaps(doc):
    """Fix truncated ToUnicode CMaps in Chinese subset Type0 fonts in-memory."""
    if not any(0x0380 <= ord(c) <= 0x1FFF for pg in doc for c in pg.get_text()):
        return doc
    seen_tu = set()
    changed = False
    for pno in range(len(doc)):
        for f in doc[pno].get_fonts(full=True):
            if f[2] != "Type0":
                continue
            obj = doc.xref_object(f[0])
            m = re.search(r"/ToUnicode\s+(\d+)\s+0\s+R", obj)
            if not m:
                continue
            tu_xref = int(m.group(1))
            if tu_xref in seen_tu:
                continue
            seen_tu.add(tu_xref)
            raw = doc.xref_stream(tu_xref).decode("latin1", errors="ignore")
            pairs = [
                (int(a, 16), int(c, 16))
                for a, _, c in re.findall(
                    r"<([0-9a-fA-F]{4})>\s*<([0-9a-fA-F]{4})>\s*<([0-9a-fA-F]{4})>", raw
                )
            ]
            if not pairs:
                continue
            diffs = [u - g for g, u in pairs if 0x4E00 <= u <= 0x9FA5]
            if not diffs:
                continue
            top_diff, cnt = Counter(diffs).most_common(1)[0]
            if top_diff in (0x49D0, 0x4A2C, 0x49CA, 0x467E) and cnt >= max(3, int(len(diffs) * 0.85)):
                mapped = dict(pairs)
                if top_diff == 0x49D0:
                    for g, u in SIMSUN_PUNCT.items():
                        mapped.setdefault(g, u)
                start_gid = max(1, 0x4E00 - top_diff)
                end_gid = 0x9FA6 - top_diff
                for g in range(start_gid, end_gid):
                    mapped.setdefault(g, g + top_diff)
                items = sorted(mapped.items())
                lines = [
                    "/CIDInit /ProcSet findresource begin",
                    "12 dict begin",
                    "begincmap",
                    "/CMapType 2 def",
                    "/CMapName /RFixed def",
                    "1 begincodespacerange",
                    "<0000><ffff>",
                    "endcodespacerange",
                ]
                for i in range(0, len(items), 100):
                    chunk = items[i : i + 100]
                    lines.append(f"{len(chunk)} beginbfrange")
                    for g, u in chunk:
                        lines.append(f"<{g:04x}><{g:04x}><{u:04x}>")
                    lines.append("endbfrange")
                lines += ["endcmap", "CMapName currentdict /CMap defineresource pop", "end end"]
                doc.update_stream(tu_xref, ("\n".join(lines)).encode("latin1"))
                changed = True
    if changed:
        return pymupdf.open(stream=doc.tobytes(), filetype="pdf")
    return doc


def clean_ocr_text(s):
    """Normalize OCR and PDF punctuation quirks."""
    if not s:
        return ""
    s = s.translate(CYRILLIC_TO_LATIN)
    s = s.replace("彳列如", "例如").replace("夕卜", "外").replace("研宄", "研究").replace("宄竟", "究竟")
    s = s.replace("„„", "……").replace("•••", "……").replace("°C", "℃").replace("°С", "℃")
    s = re.sub(r"从Г\s*C", "从0℃", s)
    s = re.sub(r"Г\s*C", "1℃", s)
    s = s.replace("Л", "____")
    s = s.replace("\u3000", " ").replace("\xa0", " ")
    # Collapse horizontal spaces inside numbers in OCR like "4 6 ." or "1 0 0 ."
    s = re.sub(r"(?<=\d)[ \t]+(?=\d)", "", s)
    s = re.sub(r"^%[ \t]*[.．•]", "90.", s)
    s = re.sub(r"(\n[ \t]*)%[ \t]*[.．•]", r"\g<1>90.", s)
    return s.strip()


def is_footer_or_noise(text, y0, y1, page_h=842):
    t = text.strip()
    if not t:
        return True
    if "my-hsk.com" in t.lower():
        return True
    if y0 > page_h - 68:
        if re.match(r"^(?:H\s*\d{5}|HSK.*样卷)\s*[-—]?\s*\d+$", t):
            return True
        if re.match(r"^[-—]?\s*\d+\s*[-—]?$", t):
            return True
    if y1 < 92 and re.match(r"^[-—]\s*\d+\s*[-—]$", t):
        return True
    return False


def is_pinyin_token(text):
    """Return True if span text is pure Pinyin (no CJK, has Latin letters, not standalone A-F option label)."""
    t = text.strip()
    if not t:
        return False
    if any("\u4e00" <= c <= "\u9fff" for c in t):
        return False
    # Standalone option labels A..F or V/X or Roman numerals
    if re.match(r"^[A-F](\s*[√×VX])?$", t):
        return False
    if re.match(r"^[VX√×★0-9\s.,:：?？!！()（）/+-]+$", t):
        return False
    return bool(re.search(r"[a-zA-Zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]", t))


def extract_page_lines(page, has_ruby=False, two_col=False):
    """Extract ordered lines from a PDF page.
    Returns list of dicts: {y, x0, x1, col, text, pinyin}
    """
    h = page.rect.height
    raw_spans = []
    d = page.get_text("dict")
    for b in d.get("blocks", []):
        if b.get("type") != 0:
            continue
        for l in b.get("lines", []):
            for s in l.get("spans", []):
                txt = clean_ocr_text(s.get("text", ""))
                if not txt:
                    continue
                x0, y0, x1, y1 = s["bbox"]
                if is_footer_or_noise(txt, y0, y1, h):
                    continue
                raw_spans.append({
                    "x0": x0, "y0": y0, "x1": x1, "y1": y1,
                    "yc": (y0 + y1) / 2.0,
                    "size": s.get("size", 12.0),
                    "text": txt,
                })

    if not raw_spans:
        return []

    if has_ruby:
        py_spans = []
        zh_spans = []
        for sp in raw_spans:
            # In HSK1/2, ruby pinyin uses smaller font (~7-9.5pt) or pure pinyin tokens above hanzi
            if is_pinyin_token(sp["text"]) and sp["size"] <= 10.6:
                py_spans.append(sp)
            else:
                zh_spans.append(sp)
    else:
        py_spans = []
        zh_spans = raw_spans

    def cluster_rows(spans, y_tol=5.5):
        if not spans:
            return []
        col_split = 295.0 if two_col else 99999.0
        sorted_sp = sorted(spans, key=lambda s: (0 if s["x0"] < col_split else 1, s["yc"], s["x0"]))
        rows = []
        for sp in sorted_sp:
            col = 0 if sp["x0"] < col_split else 1
            if rows and rows[-1]["col"] == col and abs(sp["yc"] - rows[-1]["yc"]) <= y_tol:
                rows[-1]["spans"].append(sp)
                rows[-1]["yc"] = sum(x["yc"] for x in rows[-1]["spans"]) / len(rows[-1]["spans"])
                rows[-1]["y0"] = min(rows[-1]["y0"], sp["y0"])
                rows[-1]["y1"] = max(rows[-1]["y1"], sp["y1"])
                rows[-1]["x0"] = min(rows[-1]["x0"], sp["x0"])
                rows[-1]["x1"] = max(rows[-1]["x1"], sp["x1"])
            else:
                rows.append({
                    "col": col, "yc": sp["yc"],
                    "y0": sp["y0"], "y1": sp["y1"],
                    "x0": sp["x0"], "x1": sp["x1"],
                    "spans": [sp],
                })
        out = []
        for r in rows:
            sps = sorted(r["spans"], key=lambda x: x["x0"])
            parts = []
            prev_x1 = None
            for sp in sps:
                gap = (sp["x0"] - prev_x1) if prev_x1 is not None else 0
                if prev_x1 is not None and gap > 14:
                    parts.append("  ")
                elif prev_x1 is not None and gap > 3.5 and (
                    re.match(r"^[A-Za-z0-9]", sp["text"]) or re.search(r"[A-Za-z0-9]$", parts[-1])
                ):
                    parts.append(" ")
                parts.append(sp["text"])
                prev_x1 = sp["x1"]
            joined = clean_ocr_text("".join(parts))
            if joined:
                out.append({
                    "col": r["col"], "y": r["yc"], "y0": r["y0"], "y1": r["y1"],
                    "x0": r["x0"], "x1": r["x1"], "text": joined, "spans": sps, "pinyin": "",
                })
        return out

    zh_rows = cluster_rows(zh_spans, y_tol=5.5)
    if has_ruby and py_spans:
        py_rows = cluster_rows(py_spans, y_tol=4.5)
        for pr in py_rows:
            # Attach pinyin row to the closest Chinese row immediately below it (within 4..20pt)
            best = None
            best_dy = 999.0
            for zr in zh_rows:
                dy = zr["y"] - pr["y"]
                if 2.0 <= dy <= 22.0 and dy < best_dy:
                    best = zr
                    best_dy = dy
            if best is not None:
                py_text = " ".join(sp["text"] for sp in sorted(pr["spans"], key=lambda x: x["x0"]))
                py_text = re.sub(r"\s+", " ", py_text).replace(" ．", ".").replace("．", ".").strip()
                best["pinyin"] = (best["pinyin"] + " " + py_text).strip() if best["pinyin"] else py_text

    return zh_rows


def extract_page_images(page, set_id, page_idx, save=True):
    """Detect and merge adjacent embedded images on a page, returning sorted image dicts."""
    w_page, h_page = page.rect.width, page.rect.height
    infos = page.get_image_info(xrefs=True)
    rects = []
    for info in infos:
        x0, y0, x1, y1 = info["bbox"]
        w, h = x1 - x0, y1 - y0
        # Skip full-page background scans
        if w > w_page * 0.82 and h > h_page * 0.78:
            continue
        # Skip tiny lines/artifacts or top-left Hanban header logo
        if w < 18 or h < 18:
            continue
        if y1 < 135 and x0 < 230:
            continue
        rects.append(pymupdf.Rect(x0, y0, x1, y1))

    # Merge touching or nearly touching image strips (e.g. sliced photos)
    merged = True
    while merged:
        merged = False
        new_rects = []
        used = [False] * len(rects)
        for i in range(len(rects)):
            if used[i]:
                continue
            r = rects[i]
            for j in range(i + 1, len(rects)):
                if used[j]:
                    continue
                o = rects[j]
                # Expand by 5pt to test adjacency/overlap
                expanded = pymupdf.Rect(r.x0 - 5, r.y0 - 5, r.x1 + 5, r.y1 + 5)
                if expanded.intersects(o):
                    # Only merge if roughly aligned horizontally or vertically (same photo strip)
                    x_overlap = min(r.x1, o.x1) - max(r.x0, o.x0)
                    y_overlap = min(r.y1, o.y1) - max(r.y0, o.y0)
                    if x_overlap > min(r.width, o.width) * 0.65 or y_overlap > min(r.height, o.height) * 0.65:
                        r = r | o
                        used[j] = True
                        merged = True
            new_rects.append(r)
        rects = new_rects

    # Filter merged rects that are still too small or wide banner examples with text (keep normal boxes)
    out = []
    rects.sort(key=lambda r: (round(r.y0 / 28), r.x0))
    set_img_dir = IMG_DIR / set_id
    if save and rects:
        set_img_dir.mkdir(parents=True, exist_ok=True)

    for idx, r in enumerate(rects):
        if r.width < 20 or r.height < 20:
            continue
        rel = f"img/{set_id}/p{page_idx + 1}_{idx}.jpg"
        if save:
            clip = pymupdf.Rect(
                max(0, r.x0 - 2), max(0, r.y0 - 2),
                min(w_page, r.x1 + 2), min(h_page, r.y1 + 2),
            )
            pix = page.get_pixmap(clip=clip, dpi=150, alpha=False)
            pix.save(str(EXAM_DIR / rel), jpg_quality=85)
        out.append({
            "x0": r.x0, "y0": r.y0, "x1": r.x1, "y1": r.y1,
            "xc": (r.x0 + r.x1) / 2.0, "yc": (r.y0 + r.y1) / 2.0,
            "w": r.width, "h": r.height,
            "src": rel,
        })
    return out


def parse_answers(pages, level):
    """Parse official answer dictionary {q_num: answer_str} from answer pages."""
    lines = []
    for pg in pages:
        for r in extract_page_lines(pg, has_ruby=False, two_col=False):
            lines.append(r["text"])
    full = "\n".join(lines)

    answers = {}
    spec = LEVEL_SPECS[level]
    total = spec["total"]

    # Determine objective range vs writing range
    obj_max = {1: 40, 2: 60, 3: 70, 4: 85, 5: 90, 6: 100}[level]

    # Split text into objective section and writing section if 三、书写 exists
    m_write = re.search(r"三\s*[、.．]?\s*书\s*写", full)
    obj_text = full[: m_write.start()] if m_write else full
    write_text = full[m_write.end() :] if m_write else ""

    # Objective answers:
    # 1) HSK4 Q56-65 3-letter order answers like "56．B A C" or "56. BAC" or "63,.BCA"
    if level == 4:
        for m in re.finditer(r"(?<!\d)(5[6-9]|6[0-5])(?:\s*[.．、,:：]+\s*|\s+)([A-C])\s*([A-C])\s*([A-C])", obj_text):
            qn = int(m.group(1))
            answers[qn] = m.group(2) + m.group(3) + m.group(4)

    # 2) Standard single-token answers: √, ×, V, X, A-F (including OCR space-only like "28 A")
    for m in re.finditer(r"(?<!\d)(\d{1,3})(?:\s*[.．、,:：]+\s*|\s+)([√×VX✓✗A-F])(?![A-Za-z])", obj_text):
        qn = int(m.group(1))
        if 1 <= qn <= obj_max and qn not in answers:
            val = m.group(2)
            if val in ("V", "✓"):
                val = "√"
            elif val in ("X", "✗"):
                val = "×"
            answers[qn] = val

    # Writing answers (L3 Q71-80, L4 Q86-100, L5 Q91-100, L6 Q101)
    if write_text:
        # Normalize % -> 90 in writing section too
        wlines = [ln.strip() for ln in write_text.splitlines() if ln.strip()]
        cleaned_wlines = []
        last_qn = obj_max
        for ln in wlines:
            if re.match(r"^(第一部分|第二部分|（?参考答案）?|\(参考答案）?|-?\s*\d+\s*-?)$", ln):
                continue
            if ln.startswith("%"):
                ln = f"{last_qn + 1}." + ln[1:]
            cleaned_wlines.append(ln)
            m_num = re.match(r"^(\d{2,3})\s*[.．、]", ln)
            if m_num:
                last_qn = int(m_num.group(1))

        wjoined = "\n".join(cleaned_wlines)
        # In HSK3 Part 2 (76-80), multiple items can sit on one line: "76．出  77．元  78．叫"
        if level == 3:
            for m in re.finditer(r"(7[6-9]|80)\s*[.．、:：]\s*([^\s0-9.．]{1,4})", wjoined):
                answers[int(m.group(1))] = m.group(2).strip()
        # Sentence / essay lines starting with qn
        cur_qn = None
        cur_buf = []
        for ln in cleaned_wlines:
            if level == 3 and re.match(r"^7[6-9]\s*[.．、]", ln):
                continue
            m_q = re.match(r"^(\d{2,3})\s*[.．、:：]\s*(.*)$", ln)
            if m_q:
                qn = int(m_q.group(1))
                if obj_max < qn <= total:
                    if cur_qn is not None and cur_qn not in answers:
                        answers[cur_qn] = "".join(cur_buf).strip()
                    cur_qn = qn
                    cur_buf = [m_q.group(2).strip()]
                    continue
            if cur_qn is not None:
                if re.match(r"^(第[一二三]部分|（?略）?|\(\s*略\s*）?)$", ln):
                    continue
                cur_buf.append(ln)
        if cur_qn is not None and cur_qn not in answers:
            answers[cur_qn] = "".join(cur_buf).strip()

    for qn in list(answers.keys()):
        if answers[qn] in ("（略）", "(略)", "( 略）", "（略)", "略"):
            answers[qn] = ""
    return answers


def parse_transcripts(pages, level):
    """Parse listening transcripts into {q_num: text} (including shared passages)."""
    if not pages:
        return {}
    lines = []
    for pg in pages:
        for r in extract_page_lines(pg, has_ruby=(level in (1, 2)), two_col=False):
            lines.append(r["text"])

    # Clean boilerplate lines
    filtered = []
    skip_example = False
    for ln in lines:
        s = ln.strip()
        if not s:
            continue
        if re.search(r"(听力材料|音乐.*渐弱|欢迎参加HSK|听力考试分.*部分|听力考试现在开始|听力考试现在结束)", s):
            continue
        if re.match(r"^第[一二三四]部分$", s):
            skip_example = False
            continue
        if re.match(r"^(一共\d+\s*个?题|第\d+\s*到\d+\s*题，请选出)", s):
            continue
        if s.startswith("例如：") or s.startswith("例如:"):
            skip_example = True
            continue
        if re.match(r"^现在开始第\s*\d+", s):
            skip_example = False
            continue
        if skip_example:
            # Check if a numbered question started without "现在开始"
            if re.match(r"^(?:第\s*\d+\s*到\s*\d+\s*题是根据|\d{1,2}\s*[.．、])", s):
                skip_example = False
            else:
                continue
        filtered.append(s)

    max_listen = {1: 20, 2: 35, 3: 40, 4: 45, 5: 45, 6: 50}[level]
    transcripts = {}

    # Shared range blocks (HSK4 Part 3 late items, HSK5 Part 2 late items, HSK6 Parts 2 & 3)
    # Pattern: "第31 到34 题是根据下面一段话：" or "第16 到20 题是根据下面一段采访："
    i = 0
    cur_q = None
    cur_lines = []

    def flush_single():
        nonlocal cur_q, cur_lines
        if cur_q is not None and cur_lines:
            transcripts[cur_q] = "\n".join(cur_lines).strip()
        cur_q = None
        cur_lines = []

    while i < len(filtered):
        ln = filtered[i]
        m_range = re.match(r"^第\s*(\d{1,2})\s*[到至-]\s*(\d{1,2})\s*题是根据下面一段(?:话|采访)[：:]?(.*)$", ln)
        if m_range:
            flush_single()
            q_start, q_end = int(m_range.group(1)), int(m_range.group(2))
            passage_lines = []
            if m_range.group(3).strip():
                passage_lines.append(m_range.group(3).strip())
            i += 1
            sub_qs = {}
            cur_sub = None
            while i < len(filtered):
                nxt = filtered[i]
                if re.match(r"^第\s*\d{1,2}\s*[到至-]\s*\d{1,2}\s*题是根据", nxt):
                    break
                m_sq = re.match(r"^(\d{1,2})\s*[.．、]\s*(.*)$", nxt)
                if m_sq:
                    sqn = int(m_sq.group(1))
                    if q_start <= sqn <= q_end:
                        cur_sub = sqn
                        sub_qs[cur_sub] = [m_sq.group(2).strip()]
                        i += 1
                        continue
                    elif sqn > q_end:
                        break
                if cur_sub is not None:
                    sub_qs[cur_sub].append(nxt)
                else:
                    passage_lines.append(nxt)
                i += 1
            passage_body = "\n".join(passage_lines).strip()
            for qn in range(q_start, q_end + 1):
                q_ask = "\n".join(sub_qs.get(qn, [])).strip()
                transcripts[qn] = (passage_body + (f"\n\n问（{qn}）：{q_ask}" if q_ask else "")).strip()
            continue

        # Single question start: "1．..." or "1. ..."
        # Handle multiple short items on same block if separated, though line clustering already separated y rows
        m_q = re.match(r"^(\d{1,2})\s*[.．、]\s*(.*)$", ln)
        if m_q and 1 <= int(m_q.group(1)) <= max_listen:
            flush_single()
            cur_q = int(m_q.group(1))
            rest = m_q.group(2).strip()
            if rest:
                cur_lines.append(rest)
        elif cur_q is not None:
            cur_lines.append(ln)
        i += 1

    flush_single()
    return transcripts


def split_inline_options(line_text, line_pinyin="", keys=("A", "B", "C", "D")):
    """Split a line like 'A 商店  B 医院  C 学校' into [{key, text, pinyin}]."""
    t = re.sub(r"[√✓]\s*", "", line_text).strip()
    t = re.sub(r"^b(?=\s+[\u4e00-\u9fff])", "B", t)
    key_class = "".join(keys)
    # Match standalone option markers A..D/F (including "A：" in H40000)
    matches = list(re.finditer(rf"(?<![A-Za-z])([{key_class}])(?:\s*[.．、:：]\s*|\s+|(?=[\u4e00-\u9fff《“0-9—]))", t))
    if not matches:
        return []
    # Filter so keys are strictly increasing (A then B then C...)
    filtered_m = []
    last_idx = -1
    for m in matches:
        k = m.group(1)
        ki = keys.index(k)
        if ki > last_idx:
            filtered_m.append(m)
            last_idx = ki
    out = []
    for idx, m in enumerate(filtered_m):
        k = m.group(1)
        start = m.end()
        end = filtered_m[idx + 1].start() if idx + 1 < len(filtered_m) else len(t)
        val = t[start:end].strip()
        out.append({"key": k, "text": val, "pinyin": ""})
    return out


def split_exam_pages(exam_doc):
    """Split a unified exam PDF into (question_pages, transcript_pages, answer_pages)."""
    q_pages, t_pages, a_pages = [], [], []
    mode = "cover"
    for pno, pg in enumerate(exam_doc):
        txt = clean_ocr_text(pg.get_text())
        if not txt.strip():
            continue
        # Check answer header
        if re.search(r"(?:卷答案|样卷答案|\n答案\n|^答案\n)", "\n" + txt[:300] + "\n"):
            mode = "ans"
        elif re.search(r"听力材料", txt[:250]):
            mode = "trans"
        elif mode == "cover":
            if re.search(r"(一\s*[、.．]?\s*听\s*力|^\s*听\s*力\s*$)", txt[:250], re.M) and "分两部分" not in txt and "分三部分" not in txt:
                mode = "q"
            else:
                continue
        if mode == "q":
            q_pages.append((pno, pg))
        elif mode == "trans":
            t_pages.append(pg)
        elif mode == "ans":
            a_pages.append(pg)
    return q_pages, t_pages, a_pages


def segment_glued_keywords(text):
    """Split HSK5 Q99 keywords even if OCR dropped '、' (e.g. '博物馆保存讲解员丰富值得')."""
    t = re.sub(r"^[0-9.．、\s]+", "", text).strip()
    if any(sep in t for sep in ("、", "，", ",", "  ", " ")):
        parts = [p.strip() for p in re.split(r"[、，,\s]+", t) if p.strip()]
        if len(parts) >= 4:
            return parts
    # Greedy longest-match DP into 5 vocab words
    n = len(t)
    memo = {}

    def solve(idx, k):
        if (idx, k) in memo:
            return memo[(idx, k)]
        if idx == n and k == 0:
            return []
        if idx >= n or k <= 0:
            return None
        for end in range(min(n, idx + 5), idx, -1):
            w = t[idx:end]
            if w in VOCAB_WORDS:
                rest = solve(end, k - 1)
                if rest is not None:
                    memo[(idx, k)] = [w] + rest
                    return memo[(idx, k)]
        memo[(idx, k)] = None
        return None

    res = solve(0, 5)
    if res:
        return res
    # Fallback greedy
    out = []
    i = 0
    while i < n:
        matched = None
        for end in range(min(n, i + 4), i, -1):
            if t[i:end] in VOCAB_WORDS:
                matched = t[i:end]
                break
        if matched:
            out.append(matched)
            i += len(matched)
        else:
            out.append(t[i])
            i += 1
    return out


def collect_part_pages(q_pages, level):
    """Map each (pno, page) into (section_key, part_num) segments.
    Because a page can contain a single part (almost always in HSK PDFs!), let's check if any page has 2 parts.
    Actually in all official HSK 1-6 PDFs, every '第X部分' starts on a new page! Let's handle mid-page transitions too just in case.
    """
    sec_key = "listening"
    part_num = 1
    part_Buckets = {}  # (sec_key, part_num) -> list of (pno, page, y_min, y_max)

    for pno, pg in q_pages:
        rows = extract_page_lines(pg, has_ruby=False, two_col=False)
        # Find section / part headers on this page
        events = []
        for r in rows:
            t = r["text"].strip()
            if re.match(r"^(?:[一二三]\s*[、.．]?\s*)?听\s*力$", t):
                events.append((r["y0"], "sec", "listening"))
            elif re.match(r"^(?:[一二三]\s*[、.．]?\s*)?阅\s*读$", t) or t == "、阅读":
                events.append((r["y0"], "sec", "reading"))
            elif re.match(r"^(?:[一二三]\s*[、.．]?\s*)?书\s*写$", t):
                events.append((r["y0"], "sec", "writing"))
            else:
                mp = re.match(r"^第\s*([一二三四1234])\s*部分$", t)
                if mp:
                    p_map = {"一": 1, "二": 2, "三": 3, "四": 4, "1": 1, "2": 2, "3": 3, "4": 4}
                    events.append((r["y0"], "part", p_map[mp.group(1)]))
                elif re.match(r"^第\s*部分$", t):
                    # OCR dropped 二 or 三 in H51327? Wait: let's check question range line right below!
                    events.append((r["y0"], "part_infer", r["y0"]))

        events.sort(key=lambda e: e[0])
        if not events:
            part_Buckets.setdefault((sec_key, part_num), []).append((pno, pg, 0, pg.rect.height))
            continue

        # In HSK PDFs, headers appear at top of page (y < 160)
        for ev in events:
            if ev[1] == "sec":
                sec_key = ev[2]
                part_num = 1
            elif ev[1] == "part":
                part_num = ev[2]
            elif ev[1] == "part_infer":
                # Infer part number from "第61-70题" etc. on this page
                joined = "\n".join(x["text"] for x in rows)
                for p_cand, s_q, e_q, _, _ in next(s["parts"] for s in LEVEL_SPECS[level]["sections"] if s["key"] == sec_key):
                    if re.search(rf"第\s*{s_q}\s*[-—~到至]\s*{e_q}\s*题", joined):
                        part_num = p_cand
                        break
        part_Buckets.setdefault((sec_key, part_num), []).append((pno, pg, 0, pg.rect.height))

    return part_Buckets


def clean_blank_parens(text):
    """Normalize blank parentheses for display while removing trailing answer blanks."""
    t = re.sub(r"[（(]\s*[√×VX✓✗]\s*[)）]", "", text)
    return t.strip()


def strip_trailing_answer_parens(text):
    return re.sub(r"\s*[（(]\s*[A-F√×VX✓✗]?\s*[)）]\s*$", "", text).strip()


def parse_mc_options_from_rows(rows, q_start, q_end, keys=("A", "B", "C", "D")):
    """Parse numbered multiple-choice questions (with options on 1, 2, or 4 lines)."""
    questions = {}
    cur_qn = None
    in_example = False

    for r in rows:
        t = r["text"].strip()
        py = r.get("pinyin", "").strip()
        if not t:
            continue
        if re.match(r"^(?:[一二三]\s*[、.．]?\s*)?(?:听\s*力|阅\s*读|书\s*写)$", t) or t == "、阅读":
            continue
        if re.match(r"^第\s*[一二三四]?\s*部分$", t) or re.match(r"^第\s*\d+\s*[-—~]\s*\d+\s*题", t):
            in_example = False
            continue
        if t.startswith("例如"):
            in_example = True
            cur_qn = None
            continue

        m_q = re.match(r"^(\d{1,3})\s*[.．、•]\s*(.*)$", t)
        if m_q:
            qn = int(m_q.group(1))
            if q_start <= qn <= q_end:
                in_example = False
                cur_qn = qn
                rest = m_q.group(2).strip()
                opts = split_inline_options(rest, py, keys=keys)
                questions[qn] = {"options": opts, "pinyin_raw": py}
                continue

        if in_example or cur_qn is None:
            continue

        # Additional option lines for cur_qn (e.g. B / C / D on separate lines)
        more = split_inline_options(t, py, keys=keys)
        if more:
            existing_keys = {o["key"] for o in questions[cur_qn]["options"]}
            for o in more:
                if o["key"] not in existing_keys:
                    questions[cur_qn]["options"].append(o)
                    existing_keys.add(o["key"])
        elif questions[cur_qn]["options"]:
            # Continuation of previous option text
            questions[cur_qn]["options"][-1]["text"] += t

    for qn in questions:
        questions[qn]["options"].sort(key=lambda o: keys.index(o["key"]))
    return questions


def parse_part(level, set_id, sec_key, part_spec, pages_info, answers, transcripts, save_images=True):
    """Parse a single exam part into (groups_list, questions_list)."""
    part_num, q_start, q_end, kind, _ = part_spec
    has_ruby = level in (1, 2)
    two_col = kind == "mc4_2col"

    groups = []
    questions = []

    all_rows = []
    page_rows_And_imgs = []
    for pno, pg, _, _ in pages_info:
        rows = extract_page_lines(pg, has_ruby=has_ruby, two_col=two_col)
        imgs = extract_page_images(pg, set_id, pno, save=save_images) if (
            "img" in kind or kind in ("essay_pic_word", "essay_hsk5", "long_reading4")
        ) else []
        page_rows_And_imgs.append((pno, pg, rows, imgs))
        all_rows.extend(rows)

    # 1. tf_img (HSK1 Q1-5, HSK2 Q1-10)
    if kind == "tf_img":
        for pno, pg, rows, imgs in page_rows_And_imgs:
            for r in rows:
                m = re.match(r"^(\d{1,2})\s*[.．、]?$", r["text"].strip())
                if not m:
                    m = re.match(r"^(\d{1,2})\s*[.．、]\s*$", r["text"].strip())
                if m:
                    qn = int(m.group(1))
                    if q_start <= qn <= q_end:
                        # Closest image vertically
                        best_img = min(imgs, key=lambda im: abs(im["yc"] - r["y"])) if imgs else None
                        questions.append({
                            "n": qn, "section": sec_key, "part": part_num, "type": "tf",
                            "image": best_img["src"] if best_img else "",
                            "prompt": "", "promptPinyin": "",
                            "answer": answers.get(qn, ""),
                            "transcript": transcripts.get(qn, ""),
                        })

    # 2. mc_img3 (HSK1 Q6-10: 3 images A, B, C per question)
    elif kind == "mc_img3":
        for pno, pg, rows, imgs in page_rows_And_imgs:
            q_labels = []
            for r in rows:
                m = re.match(r"^(\d{1,2})\s*[.．、]", r["text"].strip())
                if m and q_start <= int(m.group(1)) <= q_end:
                    q_labels.append((int(m.group(1)), r["y"]))
            for qn, qy in q_labels:
                # 3 images in band [qy - 85, qy + 35]
                band = [im for im in imgs if (qy - 88) <= im["yc"] <= (qy + 35)]
                band.sort(key=lambda im: im["xc"])
                opts = []
                for idx, key in enumerate(("A", "B", "C")):
                    im_src = band[idx]["src"] if idx < len(band) else ""
                    opts.append({"key": key, "text": "", "pinyin": "", "image": im_src})
                questions.append({
                    "n": qn, "section": sec_key, "part": part_num, "type": "mc",
                    "options": opts,
                    "answer": answers.get(qn, ""),
                    "transcript": transcripts.get(qn, ""),
                })

    # 3. match_img / match_img_2g (HSK1 Q11-15, Q26-30; HSK2 Q11-20, Q36-40; HSK3 Q1-10)
    elif kind in ("match_img", "match_img_2g"):
        sub_ranges = [(q_start, q_start + 4), (q_start + 5, q_end)] if kind == "match_img_2g" else [(q_start, q_end)]
        for g_idx, (gs, ge) in enumerate(sub_ranges):
            gid = f"{sec_key[0].upper()}-P{part_num}-G{g_idx + 1}"
            # Usually one page per 5-question image pool
            pno, pg, rows, imgs = page_rows_And_imgs[min(g_idx, len(page_rows_And_imgs) - 1)]
            # Sort pool images in 2-col grid (top-to-bottom rows, left-to-right)
            expected_pool = 6 if (g_idx == 0) else 5
            pool_imgs = sorted(imgs[:expected_pool], key=lambda im: (round(im["yc"] / 65), im["xc"]))
            keys = ["A", "B", "C", "D", "E", "F"][: len(pool_imgs)]
            pool = [{"key": keys[i], "image": pool_imgs[i]["src"], "text": "", "pinyin": ""} for i in range(len(pool_imgs))]
            groups.append({"id": gid, "range": [gs, ge], "poolType": "image", "pool": pool})

            # Extract prompts if reading (or empty prompts if listening)
            q_prompts = {}
            for r in rows:
                m = re.match(r"^(\d{1,2})\s*[.．、]\s*(.*)$", r["text"].strip())
                if m and gs <= int(m.group(1)) <= ge:
                    qn = int(m.group(1))
                    if qn in q_prompts and qn + 1 <= ge and (qn + 1) not in q_prompts:
                        qn = qn + 1
                    q_prompts[qn] = (strip_trailing_answer_parens(m.group(2)), r.get("pinyin", ""))
            for qn in range(gs, ge + 1):
                pr, py = q_prompts.get(qn, ("", ""))
                questions.append({
                    "n": qn, "section": sec_key, "part": part_num, "type": "match",
                    "groupId": gid,
                    "prompt": pr, "promptPinyin": py,
                    "answer": answers.get(qn, ""),
                    "transcript": transcripts.get(qn, ""),
                })

    # 4. tf_img_word (HSK1 Q21-25)
    elif kind == "tf_img_word":
        for pno, pg, rows, imgs in page_rows_And_imgs:
            # Build map of qn -> (y, word, pinyin)
            q_items = {}
            for r in rows:
                t = r["text"].strip()
                m = re.match(r"^(\d{1,2})\s*[.．、]\s*(.*)$", t)
                if m and q_start <= int(m.group(1)) <= q_end:
                    qn = int(m.group(1))
                    q_items[qn] = {"y": r["y"], "text": clean_blank_parens(m.group(2)), "pinyin": r.get("pinyin", "")}
            # Sometimes word is in a separate block at same y (x ~ 368) if y differed slightly
            for r in rows:
                t = r["text"].strip()
                if re.match(r"^\d{1,2}\s*[.．、]", t) or t.startswith("例如") or re.match(r"^(二|第)", t):
                    continue
                if "√" in t or "×" in t:
                    continue
                for qn, item in q_items.items():
                    if not item["text"] and abs(r["y"] - item["y"]) <= 12:
                        item["text"] = clean_blank_parens(t)
                        if r.get("pinyin"):
                            item["pinyin"] = r["pinyin"]
            for qn in sorted(q_items.keys()):
                item = q_items[qn]
                best_img = min(imgs, key=lambda im: abs(im["yc"] - item["y"])) if imgs else None
                questions.append({
                    "n": qn, "section": sec_key, "part": part_num, "type": "tf",
                    "image": best_img["src"] if best_img else "",
                    "prompt": item["text"], "promptPinyin": item["pinyin"],
                    "answer": answers.get(qn, ""),
                    "transcript": "",
                })

    # 5. match_text / match_text_2g (HSK1 Q31-35 side-by-side; HSK2 Q51-60 & HSK3 Q41-50 stacked)
    elif kind in ("match_text", "match_text_2g"):
        if level == 1:
            # Side-by-side layout on 1 page: left x < 340 has 31..35, right x >= 340 has A..F!
            pno, pg, _, _ = page_rows_And_imgs[0]
            # Extract spans split at x = 345
            d = pg.get_text("dict")
            left_spans, right_spans = [], []
            for b in d.get("blocks", []):
                if b.get("type") != 0:
                    continue
                for l in b.get("lines", []):
                    for s in l.get("spans", []):
                        txt = clean_ocr_text(s.get("text", ""))
                        x0, y0, x1, y1 = s["bbox"]
                        if not txt or is_footer_or_noise(txt, y0, y1, pg.rect.height):
                            continue
                        item = {"x0": x0, "y0": y0, "x1": x1, "y1": y1, "yc": (y0 + y1) / 2, "size": s.get("size", 12), "text": txt}
                        if x0 >= 362:
                            right_spans.append(item)
                        else:
                            left_spans.append(item)

            def spans_to_lines(sps):
                py_s = [x for x in sps if is_pinyin_token(x["text"]) and x["size"] <= 10.6]
                zh_s = [x for x in sps if x not in py_s]
                zh_s.sort(key=lambda x: (round(x["yc"] / 8), x["x0"]))
                rows_out = []
                for sp in zh_s:
                    if rows_out and abs(sp["yc"] - rows_out[-1]["y"]) <= 7:
                        rows_out[-1]["spans"].append(sp)
                    else:
                        rows_out.append({"y": sp["yc"], "spans": [sp], "pinyin": ""})
                for r in rows_out:
                    r["text"] = clean_ocr_text("".join(x["text"] for x in sorted(r["spans"], key=lambda z: z["x0"])))
                for ps in sorted(py_s, key=lambda z: (z["yc"], z["x0"])):
                    best = None
                    for r in rows_out:
                        if 2 <= (r["y"] - ps["yc"]) <= 22:
                            best = r
                            break
                    if best:
                        best["pinyin"] = (best["pinyin"] + " " + ps["text"]).strip()
                return rows_out

            l_rows = spans_to_lines(left_spans)
            r_rows = spans_to_lines(right_spans)
            pool = []
            for r in r_rows:
                rt = r["text"].strip()
                if re.match(r"^(第三部分|第31)", rt):
                    continue
                m = re.match(r"^(?:[A-F]\s*)?([A-F])\s*(.*)$", rt)
                if m and m.group(1) in "ABCDEF" and m.group(2).strip():
                    pool.append({"key": m.group(1), "text": m.group(2).strip(), "pinyin": r["pinyin"], "y": r["y"]})
                elif not pool and rt:
                    pool.append({"key": "A", "text": rt, "pinyin": r["pinyin"], "y": r["y"]})
                elif pool:
                    pool[-1]["text"] += rt
                    if r["pinyin"]:
                        pool[-1]["pinyin"] = (pool[-1]["pinyin"] + " " + r["pinyin"]).strip()
            q_map = {}
            cur_q = None
            for r in l_rows:
                t = r["text"].strip()
                m = re.match(r"^(\d{2})\s*[.．、]\s*(.*)$", t)
                if m and q_start <= int(m.group(1)) <= q_end:
                    cur_q = int(m.group(1))
                    cleaned_q = re.sub(r"[B-F](?:\s+\d+)?\s*$", "", m.group(2)).strip()
                    q_map[cur_q] = {"text": strip_trailing_answer_parens(cleaned_q), "pinyin": r["pinyin"]}
                elif cur_q is not None and not t.startswith("例如"):
                    # Check if cur_q already ended with sentence punctuation while a pool option just above wrapped to x0=90
                    if re.search(r"[？?。！!]$", q_map[cur_q]["text"]):
                        wrapped_opt = next((p for p in reversed(pool) if 10 <= (r["y"] - p["y"]) <= 45 and not re.search(r"[？?。！!]$", p["text"])), None)
                        if wrapped_opt is not None:
                            wrapped_opt["text"] += t
                            if r["pinyin"]:
                                wrapped_opt["pinyin"] = (wrapped_opt["pinyin"] + " " + r["pinyin"]).strip()
                            continue
                    cleaned_q = re.sub(r"\s+[B-F](?:\s+\d+)?\s*$", "", t).strip()
                    q_map[cur_q]["text"] += cleaned_q
                    if r["pinyin"]:
                        q_map[cur_q]["pinyin"] = (q_map[cur_q]["pinyin"] + " " + r["pinyin"]).strip()
            for p in pool:
                p.pop("y", None)
            gid = "R-P3-G1"
            groups.append({"id": gid, "range": [q_start, q_end], "poolType": "text", "pool": pool})
            for qn in range(q_start, q_end + 1):
                item = q_map.get(qn, {"text": "", "pinyin": ""})
                questions.append({
                    "n": qn, "section": sec_key, "part": part_num, "type": "match",
                    "groupId": gid,
                    "prompt": item["text"], "promptPinyin": item["pinyin"],
                    "answer": answers.get(qn, ""), "transcript": "",
                })
        else:
            # Stacked 2 groups (HSK2 Q51-55 & Q56-60, HSK3 Q41-45 & Q46-50)
            sub_ranges = [(q_start, q_start + 4), (q_start + 5, q_end)]
            for g_idx, (gs, ge) in enumerate(sub_ranges):
                gid = f"{sec_key[0].upper()}-P{part_num}-G{g_idx + 1}"
                _, _, rows, _ = page_rows_And_imgs[min(g_idx, len(page_rows_And_imgs) - 1)]
                pool = []
                q_map = {}
                cur_q = None
                in_ex = False
                for r in rows:
                    t = r["text"].strip()
                    py = r.get("pinyin", "")
                    if re.match(r"^(二|第[一二三四]部分|第\d+)", t):
                        continue
                    if t.startswith("例如"):
                        in_ex = True
                        cur_q = None
                        continue
                    mq = re.match(r"^(\d{2})\s*[.．、]\s*(.*)$", t)
                    if mq and gs <= int(mq.group(1)) <= ge:
                        in_ex = False
                        cur_q = int(mq.group(1))
                        q_map[cur_q] = {"text": strip_trailing_answer_parens(mq.group(2)), "pinyin": py}
                        continue
                    if cur_q is not None:
                        q_map[cur_q]["text"] += ("\n" if re.match(r"^[AB男女][：:]", t) else "") + strip_trailing_answer_parens(t)
                        if py:
                            q_map[cur_q]["pinyin"] = (q_map[cur_q]["pinyin"] + " " + py).strip()
                        continue
                    if in_ex:
                        continue
                    mp = re.match(r"^([A-F])(?:\s+|[.．、:：]|(?=[\u4e00-\u9fff“《0-9]))(.*)$", t)
                    if mp:
                        pool.append({"key": mp.group(1), "text": mp.group(2).strip(), "pinyin": py})
                    elif pool:
                        pool[-1]["text"] += t
                        if py:
                            pool[-1]["pinyin"] = (pool[-1]["pinyin"] + " " + py).strip()
                groups.append({"id": gid, "range": [gs, ge], "poolType": "text", "pool": pool})
                for qn in range(gs, ge + 1):
                    item = q_map.get(qn, {"text": "", "pinyin": ""})
                    questions.append({
                        "n": qn, "section": sec_key, "part": part_num, "type": "match",
                        "groupId": gid,
                        "prompt": item["text"], "promptPinyin": item["pinyin"],
                        "answer": answers.get(qn, ""), "transcript": "",
                    })

    # 6. match_word / match_word_2g (HSK1 Q36-40, HSK2 Q41-45, HSK3 Q51-60, HSK4 Q46-55)
    elif kind in ("match_word", "match_word_2g"):
        sub_ranges = [(q_start, q_start + 4), (q_start + 5, q_end)] if kind == "match_word_2g" else [(q_start, q_end)]
        for g_idx, (gs, ge) in enumerate(sub_ranges):
            gid = f"{sec_key[0].upper()}-P{part_num}-G{g_idx + 1}"
            _, _, rows, _ = page_rows_And_imgs[min(g_idx, len(page_rows_And_imgs) - 1)]
            pool = []
            q_map = {}
            cur_q = None
            in_ex = False
            for r in rows:
                t = r["text"].strip()
                py = r.get("pinyin", "")
                if re.match(r"^(二|第[一二三四]部分|第\d+)", t):
                    continue
                if t.startswith("例如"):
                    in_ex = True
                    cur_q = None
                    continue
                mq = re.match(r"^(\d{2})\s*[.．、]\s*(.*)$", t)
                if mq and gs <= int(mq.group(1)) <= ge:
                    in_ex = False
                    cur_q = int(mq.group(1))
                    q_map[cur_q] = {"text": mq.group(2).strip(), "pinyin": py}
                    continue
                if not in_ex and cur_q is None:
                    opts = split_inline_options(t, py, keys=("A", "B", "C", "D", "E", "F"))
                    if opts:
                        existing = {p["key"] for p in pool}
                        for o in opts:
                            if o["key"] not in existing:
                                pool.append(o)
                                existing.add(o["key"])
                        continue
                # Sometimes F option was placed at end of rows if x was far right; check before cur_q
                if cur_q is not None:
                    # Check if an isolated "F 短信" block appeared out of y-order? No, rows are y-sorted!
                    sep = "\n" if re.match(r"^[AB男女][：:]", t) else ""
                    q_map[cur_q]["text"] += sep + t
                    if py:
                        q_map[cur_q]["pinyin"] = (q_map[cur_q]["pinyin"] + " " + py).strip()

            pool.sort(key=lambda o: "ABCDEF".index(o["key"]))
            groups.append({"id": gid, "range": [gs, ge], "poolType": "text", "pool": pool})
            for qn in range(gs, ge + 1):
                item = q_map.get(qn, {"text": "", "pinyin": ""})
                prompt_clean = re.sub(r"[（(]\s*[)）]", "（　　）", item["text"])
                questions.append({
                    "n": qn, "section": sec_key, "part": part_num, "type": "match",
                    "groupId": gid,
                    "prompt": prompt_clean, "promptPinyin": item["pinyin"],
                    "answer": answers.get(qn, ""), "transcript": "",
                })

    # 7. tf_passage (HSK2 Q46-50) & tf_listen (HSK3 Q11-20, HSK4 Q1-10)
    elif kind in ("tf_passage", "tf_listen"):
        q_map = {}
        cur_q = None
        for r in all_rows:
            t = r["text"].strip()
            py = r.get("pinyin", "")
            if re.match(r"^(一|二|听力|阅读|第[一二三四]部分|第\d+)", t):
                continue
            if t.startswith("例如"):
                cur_q = None
                continue
            mq = re.match(r"^(\d{1,2})\s*[.．、•|]\s*(.*)$", t)
            if not mq and re.match(r"^(\d{1,2})\s*★", t):
                mq = re.match(r"^(\d{1,2})\s*(★.*)$", t)
            if mq and q_start <= int(mq.group(1)) <= q_end:
                cur_q = int(mq.group(1))
                rest = strip_trailing_answer_parens(mq.group(2))
                q_map[cur_q] = {"lines": [rest] if rest else [], "pinyins": [py] if py else []}
                continue
            if cur_q is not None:
                cleaned = strip_trailing_answer_parens(t)
                if cleaned:
                    q_map[cur_q]["lines"].append(cleaned)
                    if py:
                        q_map[cur_q]["pinyins"].append(py)

        for qn in range(q_start, q_end + 1):
            item = q_map.get(qn, {"lines": [], "pinyins": []})
            joined = " ".join(item["lines"])
            if "★" in joined:
                 idx_star = joined.index("★")
                 passage_part = joined[:idx_star].strip()
                 stmt_part = joined[idx_star:].strip()
            else:
                passage_part = ""
                stmt_part = joined.strip()
            questions.append({
                "n": qn, "section": sec_key, "part": part_num, "type": "tf",
                "prompt": passage_part,
                "promptPinyin": " ".join(item["pinyins"]).strip() if has_ruby else "",
                "question": stmt_part,
                "answer": answers.get(qn, ""),
                "transcript": transcripts.get(qn, ""),
            })

    # 8. mc3 / mc4 / mc4_2col (Listening MC across HSK 1-6)
    elif kind in ("mc3", "mc4", "mc4_2col"):
        keys = ("A", "B", "C") if kind == "mc3" else ("A", "B", "C", "D")
        parsed = parse_mc_options_from_rows(all_rows, q_start, q_end, keys=keys)
        for qn in range(q_start, q_end + 1):
            opts = parsed.get(qn, {}).get("options", [])
            questions.append({
                "n": qn, "section": sec_key, "part": part_num, "type": "mc",
                "options": opts,
                "answer": answers.get(qn, ""),
                "transcript": transcripts.get(qn, ""),
            })

    # 9. order (HSK4 Q56-65: A, B, C clauses -> 3-letter sequence)
    elif kind == "order":
        parsed = parse_mc_options_from_rows(all_rows, q_start, q_end, keys=("A", "B", "C"))
        for qn in range(q_start, q_end + 1):
            opts = parsed.get(qn, {}).get("options", [])
            questions.append({
                "n": qn, "section": sec_key, "part": part_num, "type": "order",
                "options": opts,
                "answer": answers.get(qn, ""),
                "transcript": "",
            })

    # 10. mc_passage3 (HSK3 Q61-70) & mc_passage4 (HSK4 Q66-85, including 80-81, 82-83, 84-85)
    elif kind in ("mc_passage3", "mc_passage4"):
        keys = ("A", "B", "C") if kind == "mc_passage3" else ("A", "B", "C", "D")
        i = 0
        in_ex = False
        cur_group = None
        cur_q = None
        q_data = {}

        while i < len(all_rows):
            t = all_rows[i]["text"].strip()
            i += 1
            if re.match(r"^(二|阅读|第[一二三四]部分|第\s*\d+\s*[-—~]\s*\d+\s*题)", t):
                in_ex = False
                continue
            if t.startswith("例如"):
                in_ex = True
                continue

            # Check range header like "80-81．" or "80-81."
            mr = re.match(r"^(\d{2})\s*[-—~]\s*(\d{2})\s*[.．、]?\s*(.*)$", t)
            if mr and q_start <= int(mr.group(1)) <= q_end:
                in_ex = False
                gs, ge = int(mr.group(1)), int(mr.group(2))
                gid = f"R-P{part_num}-{gs}_{ge}"
                cur_group = {"id": gid, "range": [gs, ge], "poolType": "passage", "passage": mr.group(3).strip(), "q_cursor": gs - 1}
                groups.append(cur_group)
                cur_q = None
                continue

            # Check single question start "66．..."
            mq = re.match(r"^(\d{2})\s*[.．、]\s*(.*)$", t)
            if mq and q_start <= int(mq.group(1)) <= q_end:
                in_ex = False
                cur_group = None
                cur_q = int(mq.group(1))
                q_data[cur_q] = {"prompt": mq.group(2).strip(), "question": "", "options": [], "groupId": ""}
                continue

            if in_ex:
                continue

            if cur_group is not None:
                if t.startswith("★"):
                    cur_group["q_cursor"] += 1
                    cur_q = cur_group["q_cursor"]
                    q_data[cur_q] = {"prompt": "", "question": t, "options": [], "groupId": cur_group["id"]}
                elif cur_q is not None:
                    opts = split_inline_options(t, keys=keys)
                    if opts:
                        existing = {o["key"] for o in q_data[cur_q]["options"]}
                        for o in opts:
                            if o["key"] not in existing:
                                q_data[cur_q]["options"].append(o)
                    elif not q_data[cur_q]["options"]:
                        q_data[cur_q]["question"] += t
                else:
                    cur_group["passage"] += t
            elif cur_q is not None:
                if t.startswith("★"):
                    q_data[cur_q]["question"] = t
                else:
                    opts = split_inline_options(t, keys=keys)
                    if opts and (q_data[cur_q]["question"] or len(opts) >= 2):
                        existing = {o["key"] for o in q_data[cur_q]["options"]}
                        for o in opts:
                            if o["key"] not in existing:
                                q_data[cur_q]["options"].append(o)
                    elif q_data[cur_q]["options"]:
                        q_data[cur_q]["options"][-1]["text"] += t
                    elif q_data[cur_q]["question"]:
                        q_data[cur_q]["question"] += t
                    else:
                        q_data[cur_q]["prompt"] += t

        for qn in range(q_start, q_end + 1):
            d = q_data.get(qn, {"prompt": "", "question": "", "options": [], "groupId": ""})
            d["options"].sort(key=lambda o: keys.index(o["key"]))
            questions.append({
                "n": qn, "section": sec_key, "part": part_num, "type": "mc",
                "groupId": d["groupId"],
                "prompt": d["prompt"],
                "question": d["question"],
                "options": d["options"],
                "answer": answers.get(qn, ""),
                "transcript": "",
            })

    # 11. cloze_mc4 (HSK5 Q46-60) & long_reading4 (HSK5 Q71-90, HSK6 Q81-100)
    elif kind in ("cloze_mc4", "long_reading4"):
        keys = ("A", "B", "C", "D")
        cur_group = None
        cur_q = None
        q_data = {}

        # Map page index -> first illustration if any
        for pno, pg, rows, imgs in page_rows_And_imgs:
            page_img = imgs[0]["src"] if imgs else ""
            for r in rows:
                t = r["text"].strip()
                if re.match(r"^(二|、?阅读|第[一二三四]部分|第\s*\d+\s*[-—~]\s*\d+\s*题)", t):
                    continue
                mr = re.match(r"^(\d{2})\s*[-—~]\s*(\d{2,3})\s*[.．、]?\s*(.*)$", t)
                if mr and q_start <= int(mr.group(1)) <= q_end:
                    gs, ge = int(mr.group(1)), int(mr.group(2))
                    gid = f"R-P{part_num}-{gs}_{ge}"
                    cur_group = {
                        "id": gid, "range": [gs, ge], "poolType": "passage",
                        "passage": mr.group(3).strip(), "image": page_img,
                    }
                    groups.append(cur_group)
                    cur_q = None
                    continue

                mq = re.match(r"^(\d{2,3})\s*[.．、•]\s*(.*)$", t)
                if mq and q_start <= int(mq.group(1)) <= q_end:
                    qn = int(mq.group(1))
                    # Make sure this isn't inside the passage body (e.g. a year) - qn must be within cur_group range if cur_group exists
                    if cur_group is None or (cur_group["range"][0] <= qn <= cur_group["range"][1]):
                        cur_q = qn
                        rest = mq.group(2).strip()
                        opts = split_inline_options(rest, keys=keys)
                        if opts and rest.startswith("A"):
                            q_data[cur_q] = {"question": "", "options": opts, "groupId": cur_group["id"] if cur_group else ""}
                        else:
                            q_data[cur_q] = {"question": rest, "options": [], "groupId": cur_group["id"] if cur_group else ""}
                        continue

                if cur_q is not None:
                    opts = split_inline_options(t, keys=keys)
                    if opts:
                        existing = {o["key"] for o in q_data[cur_q]["options"]}
                        for o in opts:
                            if o["key"] not in existing:
                                q_data[cur_q]["options"].append(o)
                                existing.add(o["key"])
                    elif q_data[cur_q]["options"]:
                        q_data[cur_q]["options"][-1]["text"] += t
                    else:
                        q_data[cur_q]["question"] += t
                elif cur_group is not None:
                    if page_img and not cur_group.get("image"):
                        cur_group["image"] = page_img
                    cur_group["passage"] += ("\n" if cur_group["passage"] else "") + t

        # Normalize cloze blanks in passage (e.g., " 46 " -> "（46）")
        if kind == "cloze_mc4":
            for g in groups:
                p_txt = g["passage"]
                for b_num in range(g["range"][0], g["range"][1] + 1):
                    p_txt = re.sub(rf"[_\s]*\b{b_num}\b[_\s]*", f"（{b_num}）", p_txt)
                g["passage"] = p_txt

        for qn in range(q_start, q_end + 1):
            d = q_data.get(qn, {"question": "", "options": [], "groupId": ""})
            d["options"].sort(key=lambda o: keys.index(o["key"]))
            questions.append({
                "n": qn, "section": sec_key, "part": part_num, "type": "mc",
                "groupId": d["groupId"],
                "prompt": "",
                "question": d["question"] or (f"空欄（{qn}）に入るものを選んでください。" if kind == "cloze_mc4" else ""),
                "options": d["options"],
                "answer": answers.get(qn, ""),
                "transcript": "",
            })

    # 12. mc_consistent4 (HSK5 Q61-70), mc_error4 (HSK6 Q51-60), mc_fillmulti4 (HSK6 Q61-70)
    elif kind in ("mc_consistent4", "mc_error4", "mc_fillmulti4"):
        keys = ("A", "B", "C", "D")
        q_data = {}
        cur_q = None
        for r in all_rows:
            t = r["text"].strip()
            if re.match(r"^(二|、?阅读|第[一二三四]部分|第\s*\d+\s*[-—~]\s*\d+\s*题)", t):
                continue
            mq = re.match(r"^(\d{2})\s*[.．、•]\s*(.*)$", t)
            if mq and q_start <= int(mq.group(1)) <= q_end:
                cur_q = int(mq.group(1))
                rest = mq.group(2).strip()
                opts = split_inline_options(rest, keys=keys)
                if opts and rest.startswith("A"):
                    q_data[cur_q] = {"prompt": "", "options": opts}
                else:
                    # For mc_fillmulti4, preserve spaces as blank underscores!
                    if kind == "mc_fillmulti4":
                        rest = re.sub(r"\s{2,}", " ＿＿ ", rest)
                    q_data[cur_q] = {"prompt": rest, "options": []}
                continue
            if cur_q is not None:
                opts = split_inline_options(t, keys=keys)
                if opts and (t.startswith("A") or t.startswith("B") or t.startswith("C") or t.startswith("D")):
                    existing = {o["key"] for o in q_data[cur_q]["options"]}
                    for o in opts:
                        if o["key"] not in existing:
                            if kind == "mc_fillmulti4":
                                o["text"] = re.sub(r"\s{2,}", " ／ ", o["text"].strip())
                            q_data[cur_q]["options"].append(o)
                            existing.add(o["key"])
                elif q_data[cur_q]["options"]:
                    q_data[cur_q]["options"][-1]["text"] += t
                else:
                    if kind == "mc_fillmulti4":
                        t_fmt = re.sub(r"\s{2,}", " ＿＿ ", r["text"])
                        if r["x0"] > 110 and q_data[cur_q]["prompt"].endswith("，"):
                            t_fmt = " ＿＿ " + t_fmt.strip()
                        q_data[cur_q]["prompt"] += t_fmt
                    else:
                        q_data[cur_q]["prompt"] += t

        for qn in range(q_start, q_end + 1):
            d = q_data.get(qn, {"prompt": "", "options": []})
            d["options"].sort(key=lambda o: keys.index(o["key"]))
            questions.append({
                "n": qn, "section": sec_key, "part": part_num, "type": "mc",
                "prompt": d["prompt"].strip(),
                "options": d["options"],
                "answer": answers.get(qn, ""),
                "transcript": "",
            })

    # 13. match_sentence_2g (HSK6 Q71-80: 71-75 and 76-80 with A-E sentences)
    elif kind == "match_sentence_2g":
        cur_group = None
        for pno, pg, rows, imgs in page_rows_And_imgs:
            for r in rows:
                t = r["text"].strip()
                if re.match(r"^(二|阅读|第[一二三四]部分|第\s*\d+\s*[-—~]\s*\d+\s*题)", t):
                    continue
                mr = re.match(r"^(\d{2})\s*[-—~]\s*(\d{2})\s*[.．、]?\s*(.*)$", t)
                if mr and q_start <= int(mr.group(1)) <= q_end:
                    gs, ge = int(mr.group(1)), int(mr.group(2))
                    gid = f"R-P{part_num}-{gs}_{ge}"
                    cur_group = {"id": gid, "range": [gs, ge], "poolType": "text", "passage": mr.group(3).strip(), "pool": []}
                    groups.append(cur_group)
                    continue
                if cur_group is not None:
                    mp = re.match(r"^([A-E])(?:\s+|[.．、:：]|(?=[\u4e00-\u9fff“《0-9]))(.*)$", t)
                    if mp:
                        cur_group["pool"].append({"key": mp.group(1), "text": mp.group(2).strip(), "pinyin": ""})
                    elif cur_group["pool"]:
                        cur_group["pool"][-1]["text"] += t
                    else:
                        cur_group["passage"] += ("\n" if cur_group["passage"] else "") + t

        for g in groups:
            g["passage"] = re.sub(r"[（(](\d{2})[)）]\s*_*\s*", r"（\1）", g["passage"])
            for qn in range(g["range"][0], g["range"][1] + 1):
                questions.append({
                    "n": qn, "section": sec_key, "part": part_num, "type": "match",
                    "groupId": g["id"],
                    "prompt": f"空欄（{qn}）に入る文を選んでください。",
                    "answer": answers.get(qn, ""),
                    "transcript": "",
                })

    # 14. scramble (HSK3 Q71-75, HSK4 Q86-95, HSK5 Q91-98)
    elif kind == "scramble":
        q_tokens = {}
        in_ex = False
        for r in all_rows:
            t = r["text"].strip()
            if re.match(r"^(三|书写|第[一二]部分|第\s*\d+)", t):
                in_ex = False
                continue
            if t.startswith("例如"):
                in_ex = True
                continue
            mq = re.match(r"^(\d{2})\s*[.．、•]\s*(.*)$", t)
            if mq and q_start <= int(mq.group(1)) <= q_end:
                in_ex = False
                qn = int(mq.group(1))
                raw_words = mq.group(2).strip().rstrip("_")
                toks = [w.strip() for w in re.split(r"\s+", raw_words) if w.strip()]
                q_tokens[qn] = toks

        for qn in range(q_start, q_end + 1):
            ans_raw = answers.get(qn, "")
            alts = [a.strip() for a in ans_raw.split("/") if a.strip()]
            primary = alts[0] if alts else ans_raw
            questions.append({
                "n": qn, "section": sec_key, "part": part_num, "type": "scramble",
                "tokens": q_tokens.get(qn, []),
                "answer": primary,
                "altAnswers": alts[1:] if len(alts) > 1 else [],
                "transcript": "",
            })

    # 15. char_input (HSK3 Q76-80: fill character from pinyin)
    elif kind == "char_input":
        # Extract directly with pinyin spans so we get exact pinyin above the blank!
        q_items = {}
        for pno, pg, _, _ in page_rows_And_imgs:
            rows_with_py = extract_page_lines(pg, has_ruby=True, two_col=False)
            cur_q = None
            for r in rows_with_py:
                t = r["text"].strip()
                py = r.get("pinyin", "").strip()
                if re.match(r"^(三|书写|第[一二]部分|第\s*\d+)", t) or t.startswith("例如"):
                    cur_q = None
                    continue
                mq = re.match(r"^(\d{2})\s*[.．、•]\s*(.*)$", t)
                if mq and q_start <= int(mq.group(1)) <= q_end:
                    cur_q = int(mq.group(1))
                    q_items[cur_q] = {"text": mq.group(2).strip(), "pinyin": py}
                elif cur_q is not None:
                    q_items[cur_q]["text"] += t
                    if py:
                        q_items[cur_q]["pinyin"] = (q_items[cur_q]["pinyin"] + " " + py).strip()

        for qn in range(q_start, q_end + 1):
            item = q_items.get(qn, {"text": "", "pinyin": ""})
            py_hint = item["pinyin"]
            sent = item["text"]
            # Sometimes pinyin was inline inside parens if font size was >= 10.7pt
            m_in = re.search(r"[（(]\s*([a-zA-Zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]+)\s*[)）]", sent)
            if m_in:
                if not py_hint:
                    py_hint = m_in.group(1)
                sent = sent[: m_in.start()] + "（　）" + sent[m_in.end() :]
            else:
                sent = re.sub(r"[（(]\s*[)）]", "（　）", sent)
            questions.append({
                "n": qn, "section": sec_key, "part": part_num, "type": "char_input",
                "prompt": sent,
                "pinyinHint": py_hint,
                "answer": answers.get(qn, ""),
                "transcript": "",
            })

    # 16. essay_pic_word (HSK4 Q96-100: 5 pictures + 1 keyword each)
    elif kind == "essay_pic_word":
        pno, pg, rows, imgs = page_rows_And_imgs[0]
        # Skip the top example image (y < 290), keep the 5 question images sorted in 2-col grid
        q_imgs = [im for im in imgs if im["yc"] > 285]
        if len(q_imgs) < 5 and len(imgs) >= 5:
            q_imgs = imgs[-5:]
        q_imgs.sort(key=lambda im: (round(im["yc"] / 90), im["xc"]))

        kw_map = {}
        joined_rows = "\n".join(r["text"] for r in rows)
        for m in re.finditer(r"(9[6-9]|100)\s*[.．、•]\s*([\u4e00-\u9fff]{1,6})", joined_rows):
            kw_map[int(m.group(1))] = m.group(2).strip()

        for idx, qn in enumerate(range(q_start, q_end + 1)):
            kw = kw_map.get(qn, "")
            ref = answers.get(qn, "")
            # Fallback for scanned OCR if keyword was inside image crop: infer HSK4 vocab word from reference answer!
            if not kw and ref:
                cands = [w for w in VOCAB_WORDS if len(w) >= 2 and w in ref]
                if cands:
                    kw = sorted(cands, key=lambda w: -len(w))[0]
            questions.append({
                "n": qn, "section": sec_key, "part": part_num, "type": "essay",
                "image": q_imgs[idx]["src"] if idx < len(q_imgs) else "",
                "keywords": [kw] if kw else [],
                "prompt": f"指定語句「{kw}」を使って、写真に合う1文を書いてください。" if kw else "写真と指定語句を使って1文を書いてください。",
                "answer": ref,
                "transcript": "",
            })

    # 17. essay_hsk5 (HSK5 Q99 keywords essay & Q100 picture essay)
    elif kind == "essay_hsk5":
        pno, pg, rows, imgs = page_rows_And_imgs[0]
        pic_src = imgs[-1]["src"] if imgs else ""
        kw_list = []
        after_99 = False
        for r in rows:
            t = r["text"].strip()
            if re.match(r"^99\s*[.．、•]", t):
                after_99 = True
                continue
            if re.match(r"^100\s*[.．、•]", t):
                after_99 = False
                break
            if after_99 and t:
                kw_list.extend(segment_glued_keywords(t))
        questions.append({
            "n": 99, "section": sec_key, "part": part_num, "type": "essay",
            "keywords": kw_list,
            "targetLength": 80,
            "prompt": "次の語句をすべて使って、80字前後の短い文章を書いてください。",
            "answer": answers.get(99, ""),
            "transcript": "",
        })
        questions.append({
            "n": 100, "section": sec_key, "part": part_num, "type": "essay",
            "image": pic_src,
            "keywords": [],
            "targetLength": 80,
            "prompt": "この写真にもとづいて、80字前後の短い文章を書いてください。",
            "answer": answers.get(100, ""),
            "transcript": "",
        })

    # 18. summary_hsk6 (HSK6 Q101: 10-min reading + 35-min 400-char summary)
    elif kind == "summary_hsk6":
        story_paras = []
        started_story = False
        for r in all_rows:
            t = r["text"].strip()
            if re.match(r"^(三|书写|第101\s*题)", t):
                continue
            if re.match(r"^[（(][1-5][)）]", t) or re.search(r"(时间为35\s*分钟|字数为400|直接写在答题卡上|只需复述文章内容)", t):
                continue
            started_story = True
            # Paragraph start if indented x0 >= 105
            if story_paras and r["x0"] < 102:
                story_paras[-1] += t
            else:
                story_paras.append(t)

        questions.append({
            "n": 101, "section": sec_key, "part": part_num, "type": "essay",
            "essayKind": "summary",
            "targetLength": 400,
            "readingMinutes": 10,
            "writingMinutes": 35,
            "passage": "\n\n".join(story_paras).strip(),
            "prompt": "（1）まず10分間で下の文章をじっくり読みます（メモ不可）。\n（2）その後、元の文章を見ずに400字前後の要約文（標題は自分でつける・自分の意見は入れない）を35分間で書きます。",
            "answer": answers.get(101, ""),
            "transcript": "",
        })

    return groups, questions


def decode_zip_name(info):
    try:
        return info.filename.encode("cp437").decode("gbk")
    except Exception:
        return info.filename


def discover_raw_sets():
    """Discover all 54 exam sets across HSK1_按套下载 .. HSK6_按套下载."""
    sets = []
    for level in range(1, 7):
        d = ROOT / f"HSK{level}_按套下载"
        if not d.exists():
            continue
        for item in sorted(os.listdir(d)):
            p = d / item
            stem = item[:-4] if item.endswith(".zip") else item
            if "样卷" in stem and stem.startswith(f"H{level}0000"):
                set_id = f"H{level}0000"
                code = set_id
                kind = "sample"
                title_ja = f"公式サンプル問題（{set_id}）"
            elif "圣彼得堡" in stem:
                set_id = "H4SPB"
                code = "HSK4-SPB"
                kind = "sample"
                title_ja = "参考サンプル問題（サンクトペテルブルク大学版）"
            else:
                set_id = stem
                code = stem
                kind = "past"
                title_ja = f"過去問 {stem}"

            sets.append({
                "level": level,
                "id": set_id,
                "code": code,
                "kind": kind,
                "titleJa": title_ja,
                "raw_path": p,
                "is_dir": p.is_dir(),
            })
    return sets


def load_set_pdfs_and_audio_source(entry):
    """Return (exam_doc, ans_doc_or_None, audio_bytes_and_ext_or_None)."""
    p = entry["raw_path"]
    files = {}  # decoded_name -> callable returning bytes
    audio_candidates = []  # (priority, size_bytes, ext, loader)

    if entry["is_dir"]:
        for fn in sorted(os.listdir(p)):
            fp = p / fn
            if not fp.is_file():
                continue
            if fn.endswith(".pdf"):
                files[fn] = fp.read_bytes
            elif fn.endswith((".mp3", ".wma", ".wav")):
                ext = Path(fn).suffix.lower()
                sz = fp.stat().st_size
                prio = 0 if (ext == ".mp3" and sz > 4_000_000) else (1 if ext == ".mp3" else 2)
                audio_candidates.append((prio, -sz, ext, fp.read_bytes))
    else:
        zf = zipfile.ZipFile(p)
        for info in zf.infolist():
            if info.is_dir():
                continue
            name = decode_zip_name(info)
            orig = info.filename
            if name.endswith(".pdf"):
                files[name] = (lambda z=zf, o=orig: z.read(o))
            elif name.endswith((".mp3", ".wma", ".wav")):
                ext = Path(name).suffix.lower()
                sz = info.file_size
                # Prefer official top-level 听力录音.mp3 or 64kbps 录音_2.mp3 / 孔子学院 录音.mp3 over 16kbps
                if "/" not in name and ext == ".mp3":
                    prio = 0
                elif ("孔子学院" in name or "_2.mp3" in name) and ext == ".mp3":
                    prio = 1
                elif ext == ".mp3":
                    prio = 2
                else:
                    prio = 3
                audio_candidates.append((prio, -sz, ext, (lambda z=zf, o=orig: z.read(o))))

    # Pick unified PDF if available
    unified_key = None
    for pat in ("教师版（含听力原文和答案）.pdf", "官方样卷（含听力原文和答案）.pdf", "官方样卷（含答案）.pdf", "原卷（含答案）.pdf"):
        for k in sorted(files.keys()):
            if k.endswith(pat) and "其他版本" not in k:
                unified_key = k
                break
        if unified_key:
            break

    if unified_key:
        exam_doc = repair_pdf_cmaps(pymupdf.open(stream=files[unified_key](), filetype="pdf"))
        ans_doc = None
    else:
        q_key = next((k for k in sorted(files.keys()) if ("学生题本" in k or "_题目.pdf" in k) and "其他版本" not in k), None)
        a_key = next((k for k in sorted(files.keys()) if k.endswith("答案.pdf") and "其他版本" not in k), None)
        if not q_key or not a_key:
            raise RuntimeError(f"Missing PDF in {entry['id']}: {list(files.keys())}")
        exam_doc = repair_pdf_cmaps(pymupdf.open(stream=files[q_key](), filetype="pdf"))
        ans_doc = repair_pdf_cmaps(pymupdf.open(stream=files[a_key](), filetype="pdf"))

    audio_src = None
    if audio_candidates:
        audio_candidates.sort(key=lambda x: (x[0], x[1]))
        _, _, ext, loader = audio_candidates[0]
        audio_src = (ext, loader)

    return exam_doc, ans_doc, audio_src


def transcode_audio_file(set_id, audio_src):
    """Transcode exam audio to clean mono 24kHz 32kbps MP3 in exam/audio/<set_id>.mp3."""
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    out_path = AUDIO_DIR / f"{set_id}.mp3"
    if out_path.exists() and out_path.stat().st_size > 500_000:
        # Probe duration
        dur_out = subprocess.check_output(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(out_path)],
            text=True,
        ).strip()
        return round(float(dur_out))

    ext, loader = audio_src
    raw_bytes = loader()
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tf:
        tf.write(raw_bytes)
        tmp_in = tf.name
    try:
        subprocess.run(
            [
                "ffmpeg", "-y", "-v", "error",
                "-i", tmp_in,
                "-vn", "-ac", "1", "-ar", "24000", "-b:a", "32k",
                str(out_path),
            ],
            check=True,
        )
        dur_out = subprocess.check_output(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(out_path)],
            text=True,
        ).strip()
        return round(float(dur_out))
    finally:
        if os.path.exists(tmp_in):
            os.remove(tmp_in)


def validate_set_data(set_obj):
    """Return list of validation issues for a parsed exam set."""
    issues = []
    lv = set_obj["level"]
    sid = set_obj["id"]
    expected_total = LEVEL_SPECS[lv]["total"]
    qs = set_obj["questions"]
    if len(qs) != expected_total:
        issues.append(f"{sid}: expected {expected_total} questions, got {len(qs)}")

    nums = [q["n"] for q in qs]
    if nums != list(range(1, expected_total + 1)):
        issues.append(f"{sid}: question numbers mismatch")

    group_map = {}
    for sec in set_obj["sections"]:
        for pt in sec["parts"]:
            for g in pt["groups"]:
                group_map[g["id"]] = g
                if g["poolType"] in ("image", "text"):
                    if len(g["pool"]) < 5:
                        issues.append(f"{sid} group {g['id']}: pool has only {len(g['pool'])} items")
                    for item in g["pool"]:
                        if g["poolType"] == "image" and not item.get("image"):
                            issues.append(f"{sid} group {g['id']} {item['key']}: missing image")
                        if g["poolType"] == "text" and not item.get("text"):
                            issues.append(f"{sid} group {g['id']} {item['key']}: empty text")
                elif g["poolType"] == "passage" and not g.get("passage"):
                    issues.append(f"{sid} group {g['id']}: empty passage")

    for q in qs:
        qn = q["n"]
        qtype = q["type"]
        ans = q.get("answer", "")
        if qtype == "tf":
            if ans not in ("√", "×"):
                issues.append(f"{sid} Q{qn} (tf): invalid answer {ans!r}")
            if lv in (1, 2) and q["section"] == "listening" and q["part"] == 1 and not q.get("image"):
                issues.append(f"{sid} Q{qn}: missing tf image")
        elif qtype == "mc":
            expected_opts = 3 if lv in (1, 2, 3) else 4
            opts = q.get("options", [])
            if len(opts) != expected_opts:
                issues.append(f"{sid} Q{qn} (mc): expected {expected_opts} opts, got {len(opts)}")
            valid_keys = {o["key"] for o in opts}
            if ans not in valid_keys:
                issues.append(f"{sid} Q{qn} (mc): answer {ans!r} not in {valid_keys}")
            for o in opts:
                if not o.get("text") and not o.get("image"):
                    issues.append(f"{sid} Q{qn} opt {o['key']}: empty text and image")
        elif qtype == "match":
            g = group_map.get(q.get("groupId", ""))
            if not g:
                issues.append(f"{sid} Q{qn} (match): missing group {q.get('groupId')}")
            else:
                valid_keys = {p["key"] for p in g.get("pool", [])}
                if ans not in valid_keys:
                    issues.append(f"{sid} Q{qn} (match): answer {ans!r} not in {valid_keys}")
        elif qtype == "order":
            opts = q.get("options", [])
            if len(opts) != 3:
                issues.append(f"{sid} Q{qn} (order): expected 3 clauses, got {len(opts)}")
            if set(ans) != {"A", "B", "C"} or len(ans) != 3:
                issues.append(f"{sid} Q{qn} (order): invalid order answer {ans!r}")
        elif qtype == "scramble":
            if len(q.get("tokens", [])) < 2:
                issues.append(f"{sid} Q{qn} (scramble): too few tokens {q.get('tokens')}")
            if not ans:
                issues.append(f"{sid} Q{qn} (scramble): missing answer")
        elif qtype == "char_input":
            if not q.get("pinyinHint"):
                issues.append(f"{sid} Q{qn} (char_input): missing pinyinHint")
            if not ans:
                issues.append(f"{sid} Q{qn} (char_input): missing answer")
        elif qtype == "essay":
            if lv == 6 and len(q.get("passage", "")) < 300:
                issues.append(f"{sid} Q{qn} (hsk6 summary): passage too short ({len(q.get('passage', ''))})")
            if lv == 5 and qn == 99 and len(q.get("keywords", [])) < 4:
                issues.append(f"{sid} Q{qn} (hsk5 keywords): got {q.get('keywords')}")
            if ((lv == 4 and 96 <= qn <= 100) or (lv == 5 and qn == 100)) and not q.get("image"):
                issues.append(f"{sid} Q{qn} (picture essay): missing image")

    return issues


def build_set(entry, skip_audio=False, save_images=True):
    level = entry["level"]
    set_id = entry["id"]
    exam_doc, ans_doc, audio_src = load_set_pdfs_and_audio_source(entry)

    q_pages, t_pages, a_pages = split_exam_pages(exam_doc)
    if ans_doc is not None:
        a_pages = list(ans_doc)

    answers = parse_answers(a_pages, level)
    transcripts = parse_transcripts(t_pages, level)
    part_buckets = collect_part_pages(q_pages, level)

    spec = LEVEL_SPECS[level]
    sections_out = []
    all_questions = []

    for sec_spec in spec["sections"]:
        sec_key = sec_spec["key"]
        parts_out = []
        for part_spec in sec_spec["parts"]:
            p_num, q_s, q_e, p_kind, instr_ja = part_spec
            p_pages = part_buckets.get((sec_key, p_num), [])
            if not p_pages:
                raise RuntimeError(f"{set_id}: no pages collected for {sec_key} part {p_num}")
            groups, qs = parse_part(
                level, set_id, sec_key, part_spec, p_pages,
                answers, transcripts, save_images=save_images,
            )
            # Clean internal helper keys from groups
            for g in groups:
                g.pop("q_cursor", None)
            parts_out.append({
                "part": p_num,
                "titleZh": f"第{'一二三四'[p_num - 1]}部分",
                "range": [q_s, q_e],
                "instructionJa": instr_ja,
                "groups": groups,
            })
            all_questions.extend(qs)

        sections_out.append({
            "key": sec_key,
            "titleZh": sec_spec["titleZh"],
            "titleJa": sec_spec["titleJa"],
            "count": sum(p[2] - p[1] + 1 for p in sec_spec["parts"]),
            "minutes": sec_spec["minutes"],
            "parts": parts_out,
        })

    all_questions.sort(key=lambda q: q["n"])
    has_audio = audio_src is not None
    audio_dur = 0
    if has_audio and not skip_audio:
        audio_dur = transcode_audio_file(set_id, audio_src)
    elif has_audio and (AUDIO_DIR / f"{set_id}.mp3").exists():
        try:
            dur_out = subprocess.check_output(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(AUDIO_DIR / f"{set_id}.mp3")],
                text=True,
            ).strip()
            audio_dur = round(float(dur_out))
        except Exception:
            audio_dur = 0

    set_obj = {
        "id": set_id,
        "level": level,
        "code": entry["code"],
        "kind": entry["kind"],
        "titleJa": entry["titleJa"],
        "totalQuestions": spec["total"],
        "durationMinutes": spec["duration"],
        "hasAudio": has_audio,
        "hasTranscript": bool(transcripts),
        "audio": f"audio/{set_id}.mp3" if has_audio else "",
        "audioDuration": audio_dur,
        "sections": sections_out,
        "questions": all_questions,
    }
    return set_obj, audio_src


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skip-audio", action="store_true", help="Skip ffmpeg MP3 transcoding")
    parser.add_argument("--skip-images", action="store_true", help="Skip saving cropped JPGs")
    parser.add_argument("--set", help="Only build a single set ID (for debugging)")
    args = parser.parse_args()

    SETS_DIR.mkdir(parents=True, exist_ok=True)
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)

    raw_sets = discover_raw_sets()
    if args.set:
        raw_sets = [s for s in raw_sets if s["id"] == args.set]
    print(f"Discovered {len(raw_sets)} exam sets.")

    manifest_sets = []
    all_issues = []
    audio_jobs = []

    for entry in raw_sets:
        set_obj, audio_src = build_set(entry, skip_audio=True, save_images=not args.skip_images)
        issues = validate_set_data(set_obj)
        all_issues.extend(issues)
        if audio_src and not args.skip_audio:
            audio_jobs.append((entry["id"], audio_src, set_obj))

        manifest_sets.append((set_obj, entry))

    if audio_jobs:
        print(f"Transcoding {len(audio_jobs)} audio files in parallel...")
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            future_map = {
                pool.submit(transcode_audio_file, sid, asrc): (sid, sobj)
                for sid, asrc, sobj in audio_jobs
            }
            done_cnt = 0
            for fut in concurrent.futures.as_completed(future_map):
                sid, sobj = future_map[fut]
                dur = fut.result()
                sobj["audioDuration"] = dur
                done_cnt += 1
                if done_cnt % 8 == 0 or done_cnt == len(audio_jobs):
                    print(f"  Audio transcoded: {done_cnt}/{len(audio_jobs)} (latest: {sid} = {dur}s)")

    # Write JS files
    manifest_entries = []
    for set_obj, _ in manifest_sets:
        sid = set_obj["id"]
        exp_path = EXPLANATIONS_DIR / f"{sid}.json"
        if exp_path.exists():
            exp_map = json.loads(exp_path.read_text(encoding="utf-8"))
            for q in set_obj["questions"]:
                txt = (exp_map.get(str(q["n"])) or "").strip()
                if txt:
                    q["explanationJa"] = txt
        js_body = (
            "window.HSK_EXAM_SETS = window.HSK_EXAM_SETS || {};\n"
            f"window.HSK_EXAM_SETS[{json.dumps(sid)}] = "
            + json.dumps(set_obj, ensure_ascii=False, separators=(",", ":"))
            + ";\n"
        )
        (SETS_DIR / f"{sid}.js").write_text(js_body, encoding="utf-8")

        manifest_entries.append({
            "id": sid,
            "level": set_obj["level"],
            "code": set_obj["code"],
            "kind": set_obj["kind"],
            "titleJa": set_obj["titleJa"],
            "totalQuestions": set_obj["totalQuestions"],
            "durationMinutes": set_obj["durationMinutes"],
            "hasAudio": set_obj["hasAudio"],
            "hasTranscript": set_obj["hasTranscript"],
            "audio": set_obj["audio"],
            "audioDuration": set_obj["audioDuration"],
            "sections": [
                {
                    "key": s["key"],
                    "titleZh": s["titleZh"],
                    "titleJa": s["titleJa"],
                    "count": s["count"],
                    "minutes": s["minutes"],
                }
                for s in set_obj["sections"]
            ],
        })

    if not args.set:
        manifest_js = (
            "window.HSK_EXAM_MANIFEST = "
            + json.dumps({"version": VERSION, "sets": manifest_entries}, ensure_ascii=False, indent=2)
            + ";\n"
        )
        (DATA_DIR / "manifest.js").write_text(manifest_js, encoding="utf-8")

    total_qs = sum(s["totalQuestions"] for s, _ in manifest_sets)
    print(f"Built {len(manifest_sets)} sets ({total_qs} questions total).")
    if all_issues:
        print(f"VALIDATION ISSUES ({len(all_issues)}):")
        for iss in all_issues[:60]:
            print("  -", iss)
        if len(all_issues) > 60:
            print(f"  ... and {len(all_issues) - 60} more")
        raise SystemExit(1)
    else:
        print("ALL SETS PASSED 100% STRICT VALIDATION!")


if __name__ == "__main__":
    main()
