#!/usr/bin/env python3
"""
רץ בתוך GitHub Actions (tiktok.yml).
פותח דפדפן אמיתי בענן, מחפש בטיקטוק, ומפרסם רשימת תוצאות (JSON) כ-Release.
התוסף קורא את ה-Release הזה ומציג אותו, בלי לפתוח טיקטוק בדפדפן של המשתמש.
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

Q = os.environ.get("Q", "").strip()
TYPE = os.environ.get("TYPE", "video").strip() or "video"
RUN_ID = os.environ.get("RUN_ID", "0")
REPO = os.environ.get("GITHUB_REPOSITORY", "")

VIDEO_RE = re.compile(r"https://www\.tiktok\.com/(@[^/?#]+)/video/(\d+)")
USER_RE = re.compile(r"https://www\.tiktok\.com/(@[^/?#]+)/?$")


def build_url(q, t):
    if t == "tag":
        tag = q.lstrip("#").replace(" ", "")
        return f"https://www.tiktok.com/tag/{tag}"
    if t == "user":
        return f"https://www.tiktok.com/search/user?q={q}"
    if t == "all":
        return f"https://www.tiktok.com/search?q={q}"
    return f"https://www.tiktok.com/search/video?q={q}"


EXTRACT_VIDEOS_JS = """
() => {
  const seen = new Set();
  const out = [];
  document.querySelectorAll('a[href*="/video/"]').forEach(a => {
    const href = a.href;
    const m = href.match(/https:\\/\\/www\\.tiktok\\.com\\/(@[^/?#]+)\\/video\\/(\\d+)/);
    if (!m) return;
    const url = `https://www.tiktok.com/${m[1]}/video/${m[2]}`;
    if (seen.has(url)) return;
    seen.add(url);
    const img = a.querySelector('img');
    const thumb = img ? (img.src || img.getAttribute('src') || '') : '';
    let title = a.getAttribute('aria-label') || a.title || '';
    if (!title) {
      const box = a.closest('div');
      const cap = box ? box.querySelector('[data-e2e*="desc"], [class*="Desc"], [class*="desc"]') : null;
      title = cap ? cap.innerText : '';
    }
    out.push({ url, channel: m[1], thumb, title: (title || '').trim().slice(0, 200) });
  });
  return out;
}
"""

EXTRACT_USERS_JS = """
() => {
  const seen = new Set();
  const out = [];
  document.querySelectorAll('a[href^="https://www.tiktok.com/@"]').forEach(a => {
    const href = a.href.split('?')[0];
    const m = href.match(/^https:\\/\\/www\\.tiktok\\.com\\/(@[^/]+)\\/?$/);
    if (!m) return;
    if (seen.has(m[1])) return;
    seen.add(m[1]);
    const img = a.querySelector('img');
    const thumb = img ? (img.src || '') : '';
    let name = a.getAttribute('aria-label') || '';
    if (!name) {
      const box = a.closest('div');
      const t = box ? box.querySelector('[class*="Nickname"], [class*="name"]') : null;
      name = t ? t.innerText : m[1];
    }
    out.push({ url: href, channel: m[1], thumb, title: (name || m[1]).trim().slice(0, 200) });
  });
  return out;
}
"""


def gh_release(tag, title, files):
    subprocess.run(
        ["gh", "release", "create", tag, "--title", title, "--notes", "נוצר אוטומטית"],
        check=False,
    )
    if files:
        subprocess.run(["gh", "release", "upload", tag, *[str(f) for f in files], "--clobber"], check=True)


def main():
    if not Q:
        print("לא התקבלה מילת חיפוש")
        sys.exit(1)
    if not REPO:
        print("GITHUB_REPOSITORY חסר")
        sys.exit(1)

    url = build_url(Q, TYPE)
    results = []
    error = None

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(
            viewport={"width": 1280, "height": 1600},
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
            ),
        )
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(3500)
            for _ in range(4):
                page.mouse.wheel(0, 2200)
                page.wait_for_timeout(1500)
            js = EXTRACT_USERS_JS if TYPE == "user" else EXTRACT_VIDEOS_JS
            results = page.evaluate(js)
        except Exception as e:  # noqa: BLE001
            error = str(e)
        finally:
            browser.close()

    data = {
        "q": Q,
        "type": TYPE,
        "source_url": url,
        "error": error,
        "results": results,
    }
    Path("tiktok.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    gh_release(f"tiktok-{RUN_ID}", f"חיפוש טיקטוק #{RUN_ID}", [Path("tiktok.json")])
    print(f"נמצאו {len(results)} תוצאות" + (f", שגיאה: {error}" if error else ""))


if __name__ == "__main__":
    main()
