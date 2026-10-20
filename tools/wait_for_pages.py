"""Wait until the published page serves this checkout's application files."""
import argparse
import hashlib
import time
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urljoin, urlsplit
from urllib.request import Request, urlopen


class PageAssets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = []

    def handle_starttag(self, tag, attrs):
        field = {"script": "src", "link": "href"}.get(tag)
        value = dict(attrs).get(field)
        if value and not urlsplit(value).scheme and not urlsplit(value).netloc:
            self.paths.append(value)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base_url")
    parser.add_argument("--timeout", type=float, default=600)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    page = PageAssets()
    page.feed((root / "index.html").read_text())
    assets = [("", root / "index.html"), ("data/audio-release.json", root / "data/audio-release.json")]
    for relative in page.paths:
        local = (root / unquote(urlsplit(relative).path)).resolve()
        local.relative_to(root)
        assets.append((relative, local))
    expected = [(relative, hashlib.sha256(local.read_bytes()).digest()) for relative, local in assets]
    deadline = time.monotonic() + args.timeout
    last_pending = None
    while True:
        pending = []
        for relative, digest in expected:
            try:
                url = urljoin(args.base_url.rstrip("/") + "/", relative)
                request = Request(url, headers={"User-Agent": "HSK-release-verification", "Cache-Control": "no-cache"})
                with urlopen(request, timeout=15) as response:
                    assert response.status == 200
                    assert hashlib.sha256(response.read()).digest() == digest
            except (OSError, AssertionError):
                pending.append(relative or "index.html")
        if not pending:
            print(f"Published application matches checkout: {len(expected)} files")
            return
        if pending != last_pending:
            print("Waiting for published files:", ", ".join(pending), flush=True)
            last_pending = pending
        if time.monotonic() >= deadline:
            raise SystemExit("Published application did not match this checkout before the timeout")
        time.sleep(5)


if __name__ == "__main__":
    main()
