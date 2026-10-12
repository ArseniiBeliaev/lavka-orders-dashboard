# ресайз картинок из архива items + manifest.json (название -> файл)
# python3 prepare_images.py <папка с картинками>
import csv
import json
import sys
import unicodedata
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
SRC = Path(sys.argv[1])
OUT = HERE / "items"
nfc = lambda s: unicodedata.normalize("NFC", s)

files = {nfc(p.name): p for p in SRC.iterdir()}
data_names = {nfc(i["name"]): i["name"] for i in json.loads((HERE / "data.json").read_text())["items"]}
manifest, missing = {}, []
for row in csv.DictReader(open(OUT / "positions.csv", encoding="utf-8-sig"), delimiter=";"):
    name, fname = nfc(row["Название позиции"]), nfc(row["Файл"])
    if name not in data_names or fname not in files:
        missing.append(name)
        continue
    im = Image.open(files[fname]).convert("RGBA")
    im.thumbnail((160, 160))
    bg = Image.new("RGB", (160, 160), "white")
    bg.paste(im, ((160 - im.width) // 2, (160 - im.height) // 2), im)
    out = f"{row['Код']}.jpg"
    bg.save(OUT / out, quality=85)
    manifest[data_names[name]] = out

(OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=0), encoding="utf-8")
print(len(manifest), "images mapped;", len(missing), "not matched:", missing[:10])
print("dataset items without image:", [n for n in data_names.values() if n not in manifest][:10])
