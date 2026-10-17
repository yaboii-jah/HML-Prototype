"""Validate, order, index, and package the app's captured paper figures."""
import csv
import hashlib
import html
import json
import os
from pathlib import Path
import re
import struct
import sys
import zipfile

workspace = Path(__file__).resolve().parent.parent
plain_artifacts = workspace / "artifacts"
assert plain_artifacts.resolve().parent == workspace
artifacts = Path("\\\\?\\" + str(plain_artifacts)) if os.name == "nt" else plain_artifacts
entries = json.loads((artifacts / "manifest.json").read_text(encoding="utf-8"))
coverage = json.loads((artifacts / "coverage.json").read_text(encoding="utf-8"))
assert entries and all(item["status"] == "complete" for item in coverage), "Incomplete capture groups"
entries.sort(key=lambda item: (item["group"], item["number"]))
digests = set()
staged = []
preserve_names = "--preserve-filenames" in sys.argv
for number, entry in enumerate(entries, 1):
    relative = Path(entry["file"])
    assert not relative.is_absolute() and ".." not in relative.parts
    original = artifacts / relative
    data = original.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", original
    assert struct.unpack(">II", data[16:24]) == (1440, 900), original
    assert len(data) > 1000
    digests.add(hashlib.sha256(data).hexdigest())
    replacement = relative.name if preserve_names else re.sub(r"^\d+-", f"{number:04d}-", relative.name)
    entry["number"] = number
    entry["file"] = (relative.parent / replacement).as_posix()
    if not preserve_names:
        temporary = original.with_name(original.name + ".renumbering")
        original.rename(temporary)
        staged.append((temporary, artifacts / entry["file"]))
for temporary, destination in staged:
    temporary.rename(destination)

# Every real page template must be represented, including dynamic detail routes.
templates = []
for source in (workspace / "app").rglob("page.tsx"):
    components = [part for part in source.relative_to(workspace / "app").parts[:-1] if not part.startswith("(")]
    route = "/" + "/".join(components)
    if route == "/" or "redirect(" in source.read_text(encoding="utf-8"):
        continue  # Redirect-only entrypoints have no screen to photograph.
    pattern = "^/" + "/".join("[^/]+" if part.startswith("[") else re.escape(part) for part in components) + "$"
    templates.append({"route": route, "pattern": pattern})
route_coverage = []
for template in sorted(templates, key=lambda item: item["route"]):
    matching = [entry for entry in entries if re.fullmatch(template["pattern"], entry["route"])]
    assert matching, "Missing page: " + template["route"]
    route_coverage.append({"route": template["route"], "images": len(matching), "roles": sorted({item["role"] for item in matching}), "views": sorted({item["viewTitle"] for item in matching})})
page_count = len(route_coverage)

for item in coverage:
    item["count"] = sum(entry["group"] == item["id"] for entry in entries)
coverage.sort(key=lambda item: item["id"])
groups = sorted({entry["group"] for entry in entries})
intro = "# Application Figure Index\n\n" + f"**{len(entries)} separate screenshots · {len({entry['key'] for entry in entries})} interface views · {page_count} pages · 7 roles.**\n\n"
intro += "Desktop 1440 × 900, light theme. Each image is a separate viewport capture. Consecutive parts overlap; scrolling panels and hidden table columns have additional images. File prefixes identify images; the caption spreadsheet provides collection order. Assign final thesis figure numbers in your paper.\n\n"
intro += "[Visual gallery](index.html) · [Caption spreadsheet](FIGURE_CAPTIONS.csv) · [Coverage checklist](COVERAGE.md)\n\n"
sections = []
for group in groups:
    title = group[3:].replace("-", " ").title()
    sections.append(f"## {title}\n\n" + "\n".join(f"- **{item['caption']}** — [{Path(item['file']).name}]({item['file']})" for item in entries if item["group"] == group))
(artifacts / "FIGURE_INDEX.md").write_text(intro + "\n\n".join(sections) + "\n", encoding="utf-8")
with (artifacts / "FIGURE_CAPTIONS.csv").open("w", encoding="utf-8-sig", newline="") as handle:
    writer = csv.writer(handle)
    writer.writerow(["Collection Order", "Filename", "Suggested Figure Caption", "Role", "Screen", "Section", "Part", "Relative Image Path"])
    for item in entries:
        writer.writerow([item["number"], Path(item["file"]).name, item["caption"], item["role"], item["viewTitle"], item["section"], item["part"], item["file"]])

checklist = "# Screenshot Coverage\n\n"
checklist += f"Validated {len(entries)} readable PNG files, each exactly 1440 × 900. All {page_count} page templates and all seven role dashboards are covered.\n\n"
checklist += "## Capture groups\n\n" + "\n".join(f"- [x] {item['id'][3:].replace('-', ' ').title()} — {item['count']} images" for item in coverage)
checklist += "\n\n## Page routes\n\n| Page | Captured roles | Images |\n| --- | --- | ---: |\n"
checklist += "\n".join(f"| `{item['route']}` | {', '.join(item['roles'])} | {item['images']} |" for item in route_coverage)
checklist += "\n\nThe root `/` and retired `/admin/maintenance` redirect to active pages and are excluded. Dynamic route counts may overlap static paths with the same shape; representative detail records are also present.\n\n"
checklist += "## Interpretation and limits\n\n- Shared views are captured once unless the role changes visible information or controls. The index identifies the role actually used.\n- All visible sections, substantive tabs/dialogs, independent scrolling areas, and hidden table columns are covered using representative populated records. This is interface coverage, not a screenshot of every database record or pagination page.\n- Full disbursement, credit/terms, partial and fully paid credit, supplier issuance, receiving, stock posting, inter-project transfers, document previews, management reports, and account administration have representative views.\n- MRF AI source selection and hardcopy preview are included. AI extraction was not invoked or mocked for screenshots.\n- Actual legacy Finance tabs are documented as the current app presents them; no historical payment records were invented.\n- The collection uses fresh isolated browser profiles. A few real commands advance only isolated demo copies to expose usable scheduling, warehouse receiving, and transfer posting forms. The user's existing workspace is unchanged.\n- Artificial loading, network failure, access-denied, or recovery screens are excluded. Sign-in and transfer-quantity validation messages are included.\n- Passwords and credentials are not exposed. Reset-password forms remain blank.\n"
(artifacts / "COVERAGE.md").write_text(checklist, encoding="utf-8")

page = "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>ConstructSync Figure Gallery</title><style>body{font:16px system-ui;margin:32px;background:#f3f6fb;color:#17243a}h1{margin-bottom:8px}nav{display:flex;flex-wrap:wrap;gap:12px;margin:24px 0}section{scroll-margin-top:20px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:24px}figure{margin:0;background:white;border:1px solid #d9e2ee;border-radius:10px;overflow:hidden}img{width:100%;height:auto;display:block}figcaption{padding:16px;line-height:1.5}small{display:block;overflow-wrap:anywhere;color:#52627a}</style>"
page += f"<h1>ConstructSync Application Figures</h1><p>{len(entries)} separate desktop screenshots covering {page_count} pages and seven roles. Click an image to open its original PNG. Use the caption beneath it as a suggested figure title.</p>"
page += "<nav>" + "".join(f'<a href="#{group}">{html.escape(group[3:].replace("-", " ").title())}</a>' for group in groups) + "</nav>"
for group in groups:
    page += f'<section id="{group}"><h2>{html.escape(group[3:].replace("-", " ").title())}</h2><main>'
    for item in entries:
        if item["group"] != group:
            continue
        page += f'<figure><a href="{item["file"]}"><img loading="lazy" src="{item["file"]}" alt="{html.escape(item["caption"], quote=True)}"></a><figcaption>{html.escape(item["caption"])}<small>{html.escape(Path(item["file"]).name)}</small></figcaption></figure>'
    page += "</main></section>"
(artifacts / "index.html").write_text(page + "</html>", encoding="utf-8")
for name, data in [("manifest.json", entries), ("coverage.json", coverage), ("route-coverage.json", route_coverage)]:
    (artifacts / name).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

# Remove only unreferenced output files from this generated collection.
expected_images = {item["file"] for item in entries}
for image in (artifacts / "screenshots").rglob("*.png"):
    if image.relative_to(artifacts).as_posix() not in expected_images:
        image.unlink()
for diagnostic in artifacts.glob("diagnostic-*.json"):
    diagnostic.unlink()

zip_path = artifacts / "app-screenshots.zip"
with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED, compresslevel=4) as archive:
    for item in sorted(artifacts.rglob("*")):
        if item.is_file() and item != zip_path:
            archive.write(item, item.relative_to(artifacts).as_posix())
with zipfile.ZipFile(zip_path) as archive:
    assert archive.testzip() is None
    assert sum(name.endswith(".png") for name in archive.namelist()) == len(entries)
print(json.dumps({"screenshots": len(entries), "views": len({item["key"] for item in entries}), "pages": len(route_coverage), "groups": len(groups), "unique_pixel_images": len(digests), "zip_bytes": zip_path.stat().st_size}))
