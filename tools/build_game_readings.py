"""Build game/js/readings.js: every reading (heteronym) of each single-character HSK word.

The game uses this only to choose safe wrong options for pinyin/tone questions
(a wrong option must never be another real reading of the same character).
It does not change any word, pinyin or meaning in data/vocab.js.

Run:  python3 tools/build_game_readings.py   (needs: pip install pypinyin)
"""
import json
import pathlib
import re

from pypinyin import Style, pinyin

root = pathlib.Path(__file__).resolve().parent.parent
text = (root / "data" / "vocab.js").read_text(encoding="utf-8")
items = json.loads(text[text.index("["): text.rindex("]") + 1])
chars = sorted({e["hanzi"] for e in items if len(re.findall(r"[\u3400-\u9fff]", e["hanzi"])) == 1 and len(e["hanzi"]) == 1})
out = {}
for c in chars:
    r = pinyin(c, style=Style.TONE, heteronym=True)[0]
    out[c] = sorted(set(r))
body = json.dumps(out, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
(root / "game" / "js" / "readings.js").write_text(
    "/* 自動生成（tools/build_game_readings.py・pypinyin）：1文字の単語の、ありうる読み方すべて。\n"
    "   ピンイン・声調問題で「別の正しい読み方」を不正解の選択肢にしないために使う。単語データは変更しない。 */\n"
    "window.GAME_READINGS = " + body + ";\n", encoding="utf-8")
multi = sum(1 for v in out.values() if len(v) > 1)
print(len(out), "characters;", multi, "with more than one reading")
