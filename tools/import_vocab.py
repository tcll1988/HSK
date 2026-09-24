# -*- coding: utf-8 -*-
"""Read 語彙表 from HSK6級.xlsm and write data/vocab-raw.json."""
import json
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
SRC = Path(r"C:\Users\何龍\Downloads\HSK6級.xlsm")
OUT = Path(__file__).resolve().parents[1] / "data" / "vocab-raw.json"


def plain_string(si):
    parts = []
    for child in si:
        tag = child.tag.split("}")[-1]
        if tag == "t":
            parts.append(child.text or "")
        elif tag == "r":
            node = child.find("m:t", NS)
            if node is not None and node.text:
                parts.append(node.text)
    return "".join(parts)


def cell_text(cell, strings):
    kind = cell.attrib.get("t")
    value = cell.find("m:v", NS)
    if kind == "s" and value is not None and value.text:
        return strings[int(value.text)]
    if kind == "inlineStr":
        inline = cell.find("m:is", NS)
        if inline is None:
            return ""
        return "".join(node.text or "" for node in inline.findall(".//m:t", NS))
    if value is not None and value.text:
        return value.text
    return ""


def main():
    with zipfile.ZipFile(SRC) as book:
        shared = ET.fromstring(book.read("xl/sharedStrings.xml"))
        strings = [plain_string(si) for si in shared.findall("m:si", NS)]
        sheet = ET.fromstring(book.read("xl/worksheets/sheet2.xml"))

    rows = []
    for row in sheet.findall("m:sheetData/m:row", NS):
        values = {}
        for cell in row.findall("m:c", NS):
            ref = cell.attrib.get("r", "")
            col = "".join(ch for ch in ref if ch.isalpha())
            values[col] = cell_text(cell, strings)
        ident = values.get("C", "")
        if not ident.isdigit():
            continue
        rows.append(
            {
                "id": int(ident),
                "pinyin": values.get("D", ""),
                "hanzi": values.get("E", ""),
                "level": int(values.get("F", "0") or 0),
                "pos": values.get("G", ""),
                "gloss": values.get("H", ""),
            }
        )

    rows.sort(key=lambda item: item["id"])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(rows)} rows to {OUT}")


if __name__ == "__main__":
    sys.exit(main())
