"""Collect a small licensed Commons probe set (category + out-of-catalog photos) for evaluation only.
One API request per second; only CC0 / PD / CC BY / CC BY-SA; 640px renditions; provenance to probe.csv."""

import csv
import hashlib
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

UA = "ElectroHubVisionDataset/0.1 (portfolio research; contact ouss03zam@gmail.com) python-urllib"
API = "https://commons.wikimedia.org/w/api.php"
OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)
# label: (group, expected category or "" for out-of-catalog, search terms)
PROBES = {
    "laptop": ("in", "laptops", "laptop computer open photograph"),
    "tablet": ("in", "tablets", "tablet computer iPad photograph"),
    "smartphone": ("in", "smartphones", "Samsung Galaxy smartphone"),
    "ssd": ("in", "storage-ssds", "solid-state drive SSD"),
    "nvme": ("in", "storage-ssds", "M.2 NVMe SSD"),
    "cpu": ("in", "computer-components", "desktop CPU processor heat spreader"),
    "keyboard": ("in", "keyboards-mice", "computer keyboard"),
    "mouse": ("in", "keyboards-mice", "computer mouse"),
    "smartwatch": ("in", "smartwatches", "smartwatch wrist"),
    "dslr": ("in", "cameras-photography", "Canon EOS camera body"),
    "monitor": ("in", "monitors", "computer monitor LCD desk"),
    "router": ("in", "networking-wifi", "wireless router"),
    "extender": ("in", "networking-wifi", "WiFi range extender"),
    "headphones": ("in", "headphones", "over-ear headphones"),
    "speaker": ("in", "speakers-audio", "bluetooth speaker"),
    "printer": ("in", "printers-scanners", "inkjet printer"),
    "ps5": ("in", "gaming", "PlayStation 5 console"),
    "xbox": ("adjacent", "gaming", "Xbox Series X console"),
    "television": ("adjacent", "monitors", "flat screen television living room"),
    "washing-machine": ("ood", "", "washing machine"),
    "refrigerator": ("ood", "", "refrigerator kitchen"),
    "microwave": ("ood", "", "microwave oven"),
    "vacuum": ("ood", "", "vacuum cleaner"),
    "chair": ("ood", "", "wooden chair"),
    "cat": ("ood", "", "domestic cat portrait"),
    "shoe": ("ood", "", "sneaker shoe"),
    "mug": ("ood", "", "coffee mug"),
    "bicycle": ("ood", "", "bicycle"),
    "fruit": ("ood", "", "apples fruit"),
    "car": ("ood", "", "parked car"),
    "plant": ("ood", "", "potted plant"),
}
PER = int(sys.argv[2]) if len(sys.argv) > 2 else 6
OK = re.compile(r"^(CC0|Public domain|PD.*|CC BY(-SA)? [0-9.]+.*)$", re.I)


def get(params):
    time.sleep(1.0)
    q = urllib.parse.urlencode({**params, "format": "json", "formatversion": "2"})
    request = urllib.request.Request(f"{API}?{q}", headers={"User-Agent": UA})  # noqa: S310 -- fixed https API
    with urllib.request.urlopen(request, timeout=30) as r:  # noqa: S310
        return json.load(r)


rows = []
for label, (group, cat, term) in PROBES.items():
    res = get(
        {
            "action": "query",
            "generator": "search",
            "gsrsearch": f"{term} filetype:bitmap",
            "gsrnamespace": "6",
            "gsrlimit": "30",
            "prop": "imageinfo",
            "iiprop": "url|mime|extmetadata|size",
            "iiurlwidth": "640",
        }
    )
    pages = sorted(res.get("query", {}).get("pages", []), key=lambda p: p.get("index", 0))
    n = 0
    for p in pages:
        ii = (p.get("imageinfo") or [{}])[0]
        md = ii.get("extmetadata", {})
        lic = md.get("LicenseShortName", {}).get("value", "")
        if ii.get("mime") not in ("image/jpeg", "image/png") or not OK.match(lic) or ii.get("width", 0) < 400:
            continue
        time.sleep(1.0)
        try:
            if not ii["thumburl"].startswith("https://upload.wikimedia.org/"):
                continue
            request = urllib.request.Request(ii["thumburl"], headers={"User-Agent": UA})  # noqa: S310 -- checked above
            with urllib.request.urlopen(request, timeout=30) as r:  # noqa: S310
                data = r.read()
        except OSError as exc:
            print("skip download", p["pageid"], type(exc).__name__)
            continue
        name = f"{label}-{p['pageid']}.jpg" if ii["mime"] == "image/jpeg" else f"{label}-{p['pageid']}.png"
        (OUT / name).write_bytes(data)
        rows.append(
            {
                "file": name,
                "label": label,
                "group": group,
                "category": cat,
                "title": p["title"],
                "license": lic,
                "sha256": hashlib.sha256(data).hexdigest(),
            }
        )
        n += 1
        if n >= PER:
            break
    print(label, n, flush=True)
with open(OUT / "probe.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0]))
    w.writeheader()
    w.writerows(rows)
