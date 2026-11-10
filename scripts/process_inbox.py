#!/usr/bin/env python3
"""
רץ בתוך GitHub Actions (downloader.yml).
קורא url/urls/mode/quality מתוך משתני הסביבה, מריץ yt-dlp,
ומפרסם את התוצאה כ-Release ב-GitHub (שהתוסף קורא משם).
"""
import json
import os
import re
import subprocess
import sys
import zipfile
from pathlib import Path

import yt_dlp

MODE = os.environ.get("MODE", "download").strip() or "download"
QUALITY = os.environ.get("QUALITY", "best").strip() or "best"
URL = os.environ.get("URL", "").strip()
URLS = [u.strip() for u in os.environ.get("URLS", "").splitlines() if u.strip()]
WHOLE = os.environ.get("WHOLE", "false").strip().lower() == "true"
RUN_ID = os.environ.get("RUN_ID", "0")
REPO = os.environ.get("GITHUB_REPOSITORY", "")

COOKIES = "cookies.txt" if Path("cookies.txt").exists() else None
DOWNLOAD_DIR = Path("downloads")
DOWNLOAD_DIR.mkdir(exist_ok=True)

FORMATS = {
    "best": "bestvideo*+bestaudio/best",
    "1080p": "bestvideo[height<=1080]+bestaudio/best[height<=1080]",
    "720p": "bestvideo[height<=720]+bestaudio/best[height<=720]",
    "480p": "bestvideo[height<=480]+bestaudio/best[height<=480]",
    "360p": "bestvideo[height<=360]+bestaudio/best[height<=360]",
    "audio": "bestaudio/best",
}


def base_opts():
    o = {
        "quiet": True,
        "no_warnings": True,
        "ignoreerrors": True,
        "noprogress": True,
    }
    if COOKIES:
        o["cookiefile"] = COOKIES
    return o


def clean_label(text):
    """שם תצוגה בטוח: בלי תווים שאסורים בשם קובץ או שמפרשים אותם כפקודה."""
    text = re.sub(r'[\\/:*?"<>|#\r\n\t]', " ", text or "")
    text = re.sub(r"\s+", " ", text).strip(" .")
    return text[:100]


def gh_release(tag, title, files):
    """יוצר Release (או משתמש בקיים) ומעלה אליו קבצים.

    files: רשימה של נתיבים, או של זוגות (נתיב, שם_תצוגה).
    הקובץ עצמו נשמר בשם בטוח, והשם היפה מופיע כ"תווית" (label) שהתוסף מציג.
    """
    subprocess.run(
        ["gh", "release", "create", tag, "--title", title, "--notes", "נוצר אוטומטית"],
        check=False,
    )
    args = []
    for item in files or []:
        if isinstance(item, tuple):
            path, label = item
            args.append(f"{path}#{label}" if label else str(path))
        else:
            args.append(str(item))
    if args:
        try:
            subprocess.run(["gh", "release", "upload", tag, *args, "--clobber"], check=True)
        except subprocess.CalledProcessError:
            # רשת ביטחון: אם ההעלאה עם שם התצוגה נכשלה, מעלים בלי שם תצוגה
            plain = [a.split("#", 1)[0] for a in args]
            print("העלאה עם שם תצוגה נכשלה, מנסה שוב בלי שם תצוגה")
            subprocess.run(["gh", "release", "upload", tag, *plain, "--clobber"], check=True)


def run_list():
    target = URL
    if not target:
        print("לא התקבל url"); sys.exit(1)
    opts = base_opts()
    opts.update({"extract_flat": "in_playlist", "skip_download": True})
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(target, download=False)

    is_search = target.lower().startswith("ytsearch")
    entries = info.get("entries") if info else None
    videos = []
    if entries:
        for e in entries:
            if not e:
                continue
            vid_url = e.get("url") or e.get("webpage_url")
            if vid_url and not vid_url.startswith("http"):
                vid_id = e.get("id") or vid_url
                vid_url = f"https://www.youtube.com/watch?v={vid_id}"
            videos.append({
                "title": e.get("title") or e.get("id") or "ללא שם",
                "url": vid_url,
                "duration": e.get("duration"),
                "channel": e.get("channel") or e.get("uploader") or "",
            })
    elif info:
        videos.append({
            "title": info.get("title") or "ללא שם",
            "url": info.get("webpage_url") or target,
            "duration": info.get("duration"),
        })

    title = (info or {}).get("title") or ""
    if is_search:
        title = "חיפוש: " + target.split(":", 1)[1]
    data = {
        "title": title,
        "url": target,
        "resolved_url": (info or {}).get("webpage_url") or target,
        "videos": videos,
        "search": is_search,
    }
    Path("list.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    gh_release(f"list-{RUN_ID}", f"רשימה #{RUN_ID}", [Path("list.json")])
    print(f"נמצאו {len(videos)} סרטונים")


def run_download():
    if URLS:
        targets = URLS
        no_playlist = True
    elif WHOLE and URL:
        targets = [URL]
        no_playlist = False
    elif URL:
        targets = [URL]
        no_playlist = True
    else:
        print("לא התקבל url/urls"); sys.exit(1)

    opts = base_opts()
    opts["format"] = FORMATS.get(QUALITY, FORMATS["best"])
    opts["outtmpl"] = str(DOWNLOAD_DIR / "%(title).150B [%(id)s].%(ext)s")
    opts["merge_output_format"] = "mp4"
    opts["no_playlist"] = no_playlist
    if QUALITY == "audio":
        opts["postprocessors"] = [{
            "key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192",
        }]

    # יוטיוב לפעמים מחזירה 403 ללקוח אחד ומאפשרת בלקוח אחר - לכן מנסים כמה דרכים לפי הסדר.
    ATTEMPTS = [
        ("רגיל", {}),
        ("tv + web_safari", {"extractor_args": {"youtube": {"player_client": ["tv", "web_safari"]}}}),
        ("mweb", {"extractor_args": {"youtube": {"player_client": ["mweb"]}}}),
        ("android_vr", {"extractor_args": {"youtube": {"player_client": ["android_vr"]}}}),
        ("ios", {"extractor_args": {"youtube": {"player_client": ["ios"]}}}),
    ]
    remaining = list(targets)
    for name, extra in ATTEMPTS:
        if not remaining:
            break
        print(f"ניסיון: {name} ({len(remaining)} קישורים)")
        o = {**opts, **extra, "no_warnings": False}
        failed = []
        with yt_dlp.YoutubeDL(o) as ydl:
            for t in remaining:
                try:
                    code = ydl.download([t])
                except Exception as e:
                    print("שגיאה:", str(e)[:200]); code = 1
                if code:
                    failed.append(t)
        remaining = failed

    files = sorted(p for p in DOWNLOAD_DIR.iterdir() if p.is_file())
    if not files:
        print("לא ירד שום קובץ (סרטון לא נתמך, או שחסרות עוגיות)"); sys.exit(1)

    # תמיד אורזים ל-ZIP בשם בטוח (אותיות ומספרים בלבד). כך אין בעיה עם שמות
    # בעברית או עם תווים כמו [ ] ( ) שגורמים ל-gh להיכשל, וההורדה זהה תמיד.
    # GitHub לא מאפשר קובץ גדול מ-2GB ב-Release, ולכן מחלקים לכמה ZIP-ים (עד ~1.8GB כל אחד).
    LIMIT = int(1.8 * 1024 ** 3)
    groups, current, size = [], [], 0
    for f in files:
        fsize = f.stat().st_size
        if current and size + fsize > LIMIT:
            groups.append(current)
            current, size = [], 0
        current.append(f)
        size += fsize
    if current:
        groups.append(current)

    upload = []
    for i, group in enumerate(groups, 1):
        suffix = f"-part{i}" if len(groups) > 1 else ""
        zip_path = Path(f"videos-{RUN_ID}{suffix}.zip")
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_STORED, allowZip64=True) as z:
            for f in group:
                z.write(f, arcname=f.name)
        # שם התצוגה: כותרת הסרטון (בלי ה-id שבסוף). כמה סרטונים: הראשון + "ועוד N"
        titles = [clean_label(re.sub(r"\s*\[[^\]]*\]$", "", f.stem)) for f in group]
        titles = [t for t in titles if t]
        if not titles:
            label = f"videos-{RUN_ID}{suffix}.zip"
        elif len(titles) == 1:
            label = f"{titles[0]}.zip"
        else:
            label = f"{titles[0]} ועוד {len(titles) - 1}.zip"
        if len(groups) > 1:
            label = f"חלק {i} - {label}"
        upload.append((zip_path, label))

    gh_release(f"dl-{RUN_ID}", f"הורדה #{RUN_ID}", upload)
    print(f"הועלו {len(upload)} קבצים")


if __name__ == "__main__":
    if not REPO:
        print("GITHUB_REPOSITORY חסר"); sys.exit(1)
    if MODE == "list":
        run_list()
    else:
        run_download()
