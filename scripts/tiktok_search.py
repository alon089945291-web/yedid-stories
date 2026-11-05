#!/usr/bin/env python3
"""
חיפוש בטיקטוק בדפדפן אמיתי (Playwright) בתוך GitHub Actions.
מחזיר רק רשימת קישורים (סרטון / ערוץ) כקובץ JSON ב-Release, והתוסף מציג אותה בעיצוב משלו.
משתני סביבה: Q (מה לחפש), TYPE (video | tag | user | all), RUN_ID, GITHUB_REPOSITORY.
"""
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import quote

Q = os.environ.get("Q", "").strip()[:100]
TYPE = os.environ.get("TYPE", "video").strip() or "video"
RUN_ID = os.environ.get("RUN_ID", "0")
REPO = os.environ.get("GITHUB_REPOSITORY", "")
MAX_ITEMS = 40


def build_url(kind, query):
    q = (query or "").strip()
    if not q:
        return ""
    if kind == "tag":
        tag = re.sub(r"\s+", "", q.lstrip("#"))
        return "https://www.tiktok.com/tag/" + quote(tag) if tag else ""
    if kind == "user":
        return "https://www.tiktok.com/search/user?q=" + quote(q)
    if kind == "all":
        return "https://www.tiktok.com/search?q=" + quote(q)
    return "https://www.tiktok.com/search/video?q=" + quote(q)


def load_cookies(path="cookies.txt"):
    """ממיר קובץ עוגיות (Netscape) לפורמט של Playwright, רק עוגיות טיקטוק."""
    out = []
    p = Path(path)
    if not p.exists():
        return out
    for line in p.read_text(encoding="utf-8", errors="ignore").splitlines():
        if not line.strip():
            continue
        http_only = False
        if line.startswith("#HttpOnly_"):
            http_only = True
            line = line[len("#HttpOnly_"):]
        elif line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) != 7:
            continue
        domain, _flag, path_, secure, expires, name, value = parts
        if "tiktok" not in domain:
            continue
        cookie = {
            "name": name, "value": value, "domain": domain, "path": path_ or "/",
            "secure": secure.upper() == "TRUE", "httpOnly": http_only,
        }
        try:
            exp = int(expires)
        except ValueError:
            exp = 0
        if exp > 0:
            cookie["expires"] = exp
        out.append(cookie)
    return out


def first(*values):
    for v in values:
        if v:
            return v
    return ""


def extract(payload):
    """שולף סרטונים ומשתמשים מכל JSON שחוזר מ-API של טיקטוק (מבנה גמיש)."""
    videos, users = [], []

    def walk(obj):
        if isinstance(obj, dict):
            author = obj.get("author")
            vid = str(obj.get("id", ""))
            if isinstance(author, dict) and vid.isdigit() and author.get("uniqueId"):
                video = obj.get("video") if isinstance(obj.get("video"), dict) else {}
                uid = author["uniqueId"]
                videos.append({
                    "url": f"https://www.tiktok.com/@{uid}/video/{vid}",
                    "title": (obj.get("desc") or "").strip(),
                    "author": uid,
                    "nickname": author.get("nickname") or "",
                    "cover": first(video.get("cover"), video.get("originCover"), video.get("dynamicCover")),
                })
                return
            uid = first(obj.get("unique_id"), obj.get("uniqueId"))
            if uid and (obj.get("nickname") is not None) and "video" not in obj and "desc" not in obj:
                avatar = obj.get("avatar_thumb")
                if isinstance(avatar, dict):
                    avatar = (avatar.get("url_list") or [""])[0]
                users.append({
                    "url": f"https://www.tiktok.com/@{uid}",
                    "title": obj.get("nickname") or "",
                    "author": uid,
                    "nickname": obj.get("nickname") or "",
                    "cover": first(avatar, obj.get("avatarThumb")),
                    "kind": "user",
                })
                return
            for v in obj.values():
                walk(v)
        elif isinstance(obj, list):
            for v in obj:
                walk(v)

    walk(payload)
    return videos, users


def merge(into, new_items):
    seen = {i["url"] for i in into}
    for item in new_items:
        if item["url"] not in seen and len(into) < MAX_ITEMS:
            into.append(item)
            seen.add(item["url"])


DOM_JS = """
() => Array.from(document.querySelectorAll('a[href*="/video/"]')).map(a => {
  const img = a.querySelector('img');
  return { href: a.href, text: (a.innerText || '').trim(), alt: img ? (img.alt || '') : '', src: img ? (img.src || '') : '' };
})
"""


def dom_items(rows):
    out = []
    for r in rows:
        m = re.match(r"https://www\.tiktok\.com/@([^/]+)/video/(\d+)", r.get("href", ""))
        if not m:
            continue
        out.append({
            "url": f"https://www.tiktok.com/@{m.group(1)}/video/{m.group(2)}",
            "title": (r.get("alt") or r.get("text") or "").strip(),
            "author": m.group(1),
            "nickname": "",
            "cover": r.get("src") or "",
        })
    return out


def search():
    from playwright.sync_api import sync_playwright

    url = build_url(TYPE, Q)
    if not url:
        return [], "לא התקבלו מילות חיפוש"
    items, note = [], ""

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
        ctx = browser.new_context(
            user_agent=("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"),
            locale="en-US", viewport={"width": 1280, "height": 900},
        )
        ctx.add_init_script("Object.defineProperty(navigator,'webdriver',{get:()=>undefined})")
        cookies = load_cookies()
        if cookies:
            ctx.add_cookies(cookies)
            print(f"נטענו {len(cookies)} עוגיות טיקטוק")
        page = ctx.new_page()

        def on_response(resp):
            try:
                if "/api/" not in resp.url:
                    return
                if "json" not in (resp.headers.get("content-type") or ""):
                    return
                videos, users = extract(resp.json())
                merge(items, users if TYPE == "user" else videos)
            except Exception:
                pass

        page.on("response", on_response)
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=45000)
        except Exception as err:
            print("טעינת העמוד נכשלה:", err)
        time.sleep(6)

        for _ in range(6):
            before = len(items)
            try:
                page.mouse.wheel(0, 3000)
            except Exception:
                pass
            time.sleep(1.5)
            if TYPE != "user":
                try:
                    merge(items, dom_items(page.evaluate(DOM_JS)))
                except Exception:
                    pass
            if len(items) >= MAX_ITEMS or (len(items) == before and len(items) > 0):
                break

        if not items:
            try:
                note = f"לא נמצאו תוצאות. כותרת העמוד: {page.title()[:80]} | כתובת: {page.url[:120]}"
            except Exception:
                note = "לא נמצאו תוצאות (ייתכן שטיקטוק חסם את השרת או דורש התחברות)"
        browser.close()
    return items, note


def gh_release(tag, title, path):
    subprocess.run(["gh", "release", "create", tag, "--title", title, "--notes", "נוצר אוטומטית"], check=False)
    subprocess.run(["gh", "release", "upload", tag, str(path), "--clobber"], check=True)


if __name__ == "__main__":
    if not REPO:
        print("GITHUB_REPOSITORY חסר")
        sys.exit(1)
    try:
        found, note = search()
    except Exception as err:  # מדווחים לתוסף במקום להיכשל בשקט
        found, note = [], "שגיאה בחיפוש: " + str(err)[:200]
    data = {"query": Q, "type": TYPE, "items": found, "note": note}
    out = Path(f"tt-{RUN_ID}.json")
    out.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    gh_release(f"list-tt-{RUN_ID}", f"חיפוש טיקטוק #{RUN_ID}", out)
    print(f"נמצאו {len(found)} תוצאות. {note}")
