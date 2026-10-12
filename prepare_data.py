# конвертация xlsx -> data.json, оставляю только доставленные заказы
import json
import sys
from pathlib import Path

import openpyxl

HERE = Path(__file__).resolve().parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE.parent / "Неделя 1_Визуализация_Датасет_Вариант A. Дом и дача.xlsx"

ws = openpyxl.load_workbook(SRC, read_only=True).worksheets[0]
items, cats, rows = {}, {}, []
for (order, date, status, _c, _d, _addr, name, cat, full, disc, _s, qty, total) in list(ws.iter_rows(values_only=True))[1:]:
    if status != "доставлен":
        continue
    ci = cats.setdefault(cat, len(cats))
    ii = items.setdefault(name, len(items))
    rows.append([order, date.strftime("%Y-%m-%d"), ii, ci, full, disc, qty])

rows.sort(key=lambda r: r[1])
data = {
    "items": [{"name": n, "cat": None} for n in items],
    "cats": list(cats),
    "rows": rows,
}
for r in rows:
    data["items"][r[2]]["cat"] = r[3]
(HERE / "data.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(len(rows), "rows,", len(items), "items,", len(cats), "categories")
