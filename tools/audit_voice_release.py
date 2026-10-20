"""Verify every deployed recording against its release manifest.

Uses the Python standard library. Add --decode to validate every MP3 with
FFmpeg as well as its SHA-256. Generated reports go outside the repository.
"""
import argparse
import concurrent.futures
import hashlib
import json
import subprocess
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urljoin
from urllib.request import Request, urlopen


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--decode", action="store_true")
    parser.add_argument("--report", type=Path)
    parser.add_argument("--base-url", help="Also verify every recording served by this website")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    release = json.loads((root / "data/audio-release.json").read_text())
    entries = json.loads(subprocess.check_output([
        "node", "-e",
        "const {HSK,vocab}=require('./test/load-hsk').loadHsk();"
        "console.log(JSON.stringify(vocab.map(e=>({id:e.id,pinyin:e.pinyin,"
        "spokenText:e.audioText||e.hanzi,"
        "path:decodeURIComponent(HSK.audioSrc(e))}))));",
    ], cwd=root, text=True))
    assets = release["assets"]
    assert len(entries) == release["vocabulary_count"] == 5003
    assert len({e["path"] for e in entries}) == release["unique_recording_count"] == 5001
    assert len(assets) == 5009
    indexed = {a["path"]: a for a in assets}
    assert len(indexed) == len(assets)
    for entry in entries:
        assert entry["id"] in indexed[entry["path"]]["entry_ids"], entry
        assert entry["spokenText"] == indexed[entry["path"]]["spoken_text"], entry
        assert entry["pinyin"] == indexed[entry["path"]]["pinyin"], entry
    actual = {str(p.relative_to(root)) for p in (root / "audio").rglob("*.mp3")}
    assert actual == set(indexed), "Release must cover every MP3, including legacy paths"

    def check(asset):
        relative = Path(asset["path"])
        assert relative.parts[0] == "audio" and ".." not in relative.parts
        path = root / relative
        data = path.read_bytes()
        assert len(data) == asset["bytes"] > 1000, relative
        assert hashlib.sha256(data).hexdigest() == asset["sha256"], relative
        if args.base_url:
            url = urljoin(args.base_url.rstrip("/") + "/", quote(str(relative), safe="/"))
            url += "?v=" + quote(release["version"], safe="")
            for attempt in range(3):
                try:
                    request = Request(url, headers={"User-Agent": "HSK-release-verification"})
                    with urlopen(request, timeout=30) as response:
                        assert response.status == 200, (relative, response.status)
                        data = response.read()
                    break
                except (HTTPError, URLError, OSError) as error:
                    if attempt == 2 or isinstance(error, HTTPError) and error.code < 500 and error.code != 429:
                        raise
                    time.sleep(2 * (attempt + 1))
            assert len(data) == asset["bytes"], ("Published file size differs", relative)
            assert hashlib.sha256(data).hexdigest() == asset["sha256"], ("Published audio differs", relative)
        if args.decode:
            command = [
                "ffmpeg", "-v", "error", "-xerror", "-nostdin",
                "-i", "pipe:0" if args.base_url else str(path),
                "-map", "0:a:0", "-f", "null", "-",
            ]
            subprocess.run(command, input=data if args.base_url else None, check=True, capture_output=True)
        return str(relative)

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        checked = list(pool.map(check, assets))
    result = {
        "release": release["version"], "vocabulary_entries": len(entries),
        "unique_recordings": 5001, "verified_mp3_files": len(checked),
        "sha256_verified": True, "decoded_all_mp3_files": args.decode,
        "base_url": args.base_url,
        "published_mp3_files_verified": len(checked) if args.base_url else 0,
    }
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
