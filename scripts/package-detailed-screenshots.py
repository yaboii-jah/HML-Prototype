"""Package the MRF 372 detail set without changing its parent collection."""
import csv
import hashlib
import html
import json
from pathlib import Path
import re
import shutil
import struct
import zipfile

workspace = Path(__file__).resolve().parent.parent
root = workspace / 'artifacts' / 'core-business-flow' / 'detailed-screenshots'
entries = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
validation = json.loads((root / 'VALIDATION.json').read_text(encoding='utf-8'))
entries.sort(key=lambda entry: entry['number'])
assert len(entries) == validation['captured'] == validation['expected']
assert [e['number'] for e in entries] == list(range(1, len(entries) + 1))
assert validation['sampleImportTests']['passed']
assert not validation['browserExceptions'] and not validation['externalDriveRequests']
hashes = set()
for entry in entries:
    relative = Path(entry['file'])
    assert not relative.is_absolute() and '..' not in relative.parts
    data = (root / relative).read_bytes()
    assert data[:8] == b'\x89PNG\r\n\x1a\n' and struct.unpack('>II', data[16:24]) == (1440, 900)
    digest = hashlib.sha256(data).hexdigest()
    assert digest not in hashes, f"Duplicate capture: {relative}"
    hashes.add(digest)
    entry['sha256'] = digest
    entry.pop('visibleText', None)
    numbered = relative.with_name(re.sub(r'^\d+-', f"{entry['number']:02d}-", relative.name))
    if numbered != relative:
        assert (root / numbered).resolve().is_relative_to((root / 'screenshots').resolve())
        (root / relative).rename(root / numbered)
        entry['file'] = numbered.as_posix()

retained = {entry['file'] for entry in entries}
for candidate in (root / 'screenshots').rglob('*.png'):
    relative = candidate.relative_to(root)
    if relative.as_posix() not in retained:
        assert candidate.resolve().is_relative_to((root / 'screenshots').resolve())
        destination = workspace / '.next' / 'detailed-screenshot-superseded' / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(candidate), str(destination))

groups = list(dict.fromkeys(e['group'] for e in entries))
title = 'MRF 372 — Detailed Business Flow Screenshots'
intro = (f'# {title}\n\n**{len(entries)} separate screenshots · 1440 × 900 · light theme.**\n\n'
         'Start with login, project creation, scope allocation and personnel assignments, then follow the same source MRF 372, original combined MRF/key-plan PDF, and all four original supplier quotations. '
         'One app MRF links two supplier POs and one stock transfer. Each process has its own folder.\n\n'
         '[Open gallery](index.html) · [Caption spreadsheet](FIGURE_CAPTIONS.csv) · [Test results](SAMPLE_TEST_RESULTS.json)\n\n')
index = intro
for group in groups:
    index += f'## {group[3:].replace("-", " ").title()}\n\n'
    for entry in [e for e in entries if e['group'] == group]:
        refs = ' · '.join(f'{key}: {value}' for key, value in entry['refs'].items())
        index += f"- **{entry['caption']}** — {entry['role']} — [PNG]({entry['file']})\n  {entry['purpose']} {refs}\n\n"
(root / 'FIGURE_INDEX.md').write_text(index, encoding='utf-8')
with (root / 'FIGURE_CAPTIONS.csv').open('w', encoding='utf-8-sig', newline='') as handle:
    writer = csv.writer(handle)
    writer.writerow(['Order', 'Figure Caption', 'Process', 'Role', 'Record References', 'Image Path'])
    for entry in entries:
        writer.writerow([entry['number'], entry['caption'], entry['group'], entry['role'], '; '.join(f'{key}: {value}' for key, value in entry['refs'].items()), entry['file']])

escape = html.escape
navigation = '<option value="all">All processes</option>' + ''.join(f'<option value="{group}">{escape(group[3:].replace("-", " ").title())}</option>' for group in groups)
cards = ''.join(f'<figure data-group="{entry["group"]}"><a href="{escape(entry["file"])}" target="_blank"><img loading="lazy" src="{escape(entry["file"])}" alt="{escape(entry["title"])}"></a><figcaption><small>{escape(entry["group"][3:].replace("-", " "))} · {escape(entry["role"])}</small><strong>{escape(entry["caption"])}</strong><p>{escape(entry["purpose"])}</p><small>{escape(" · ".join(entry["refs"].values()))}</small></figcaption></figure>' for entry in entries)
(root / 'index.html').write_text('''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MRF 372 Detailed Screenshots</title><style>body{font:16px/1.5 Arial,sans-serif;margin:30px;background:#f3f6fb;color:#17243a}nav{display:flex;gap:15px;align-items:center;flex-wrap:wrap;margin:24px 0}a{color:#205294}select{padding:12px;background:white;border:1px solid #bdcee4;border-radius:6px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,500px),1fr));gap:24px}figure{margin:0;background:white;border:1px solid #d9e2ee;border-radius:9px;overflow:hidden}img{display:block;width:100%}figcaption{padding:18px}strong{display:block;font-size:18px}small{color:#52627a}figure[hidden]{display:none}</style>
<h1>MRF 372 — Detailed Business Flow</h1>'''
    + f'<p>{len(entries)} screenshots from login and project creation through MRF 372, four original quotations, two purchase orders, deliveries, a stock transfer, inventory and final reports. Click an image to inspect the full-resolution PNG.</p>'
    + '<nav><label>Process <select onchange="filter(this.value)">' + navigation + '</select></label><a href="FIGURE_CAPTIONS.csv">Caption spreadsheet</a><a href="FIGURE_INDEX.md">Figure index</a><a href="../index.html">Original 36-figure set</a></nav><main>'
    + cards + '</main><script>function filter(value){for(const f of document.querySelectorAll("figure"))f.hidden=value!=="all"&&f.dataset.group!==value}</script></html>', encoding='utf-8')

test = json.loads((workspace / '.next' / 'mrf372-paper' / 'extraction.json').read_text(encoding='utf-8'))
summary = {'passed': test['passed'], 'testedAt': test['testedAt'], 'mrf': {'file': test['mrf']['file'], 'sha256': test['mrf']['sha256'], 'sourceReference': test['mrf']['data']['extraction']['details']['ref'], 'materials': len(test['mrf']['data']['extraction']['items']), 'warnings': test['mrf']['data']['warnings']}, 'quotations': [{'file': q['file'], 'supplier': q['data']['extraction']['supplier'], 'reference': q['data']['extraction']['reference'], 'materials': len(q['data']['extraction']['lines']), 'verifiedGrossPHP': q['verifiedGross'], 'vatInclusive': True, 'sha256': q['sha256']} for q in test['quotations']], 'errors': test['errors']}
(root / 'SAMPLE_TEST_RESULTS.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
(root / 'README.md').write_text(intro + '''## Connected example

Login → Project Manager dashboard → Project creation and confirmation → Architectural scope allocation → Site Personnel project assignments → MRF 372 import review and supporting attachment → Project Manager approval/archive → Source stock check/release → Four supplier quotation reviews → Comparison and awards → Two purchase orders.

Kestrel supplies seven materials through the upfront-payment example. Apex supplies 56 glass clamps through the credit/terms example. Four matching clamps come from a source project. The destination therefore receives all 60 requested clamps. Two delivered glass panels are subsequently recorded as used.

Both supplier deliveries and the transfer finish with receiving, stock posting, archived evidence, and Accounting review. Finance coordinates supplier payment; Accounting verifies it. Collection numbers are ordering aids; assign final thesis figure numbers in the paper.

## Original sources and testing

The five PDFs are read directly from `sample-data/`. They remain unchanged. Live app extraction endpoints verified eight MRF materials, eight lines per quotation, quantities, VAT-inclusive treatment, printed line amounts and supplier totals. See `SAMPLE_TEST_RESULTS.json` for file hashes and amounts. Original bytes are used in the app's source previews and supporting attachment. Approved MRFs, POs and delivery/transfer receipts use the app's document generator.

All original quotations specify 30-day payment terms. Kestrel's upfront arrangement is a subsequent **fictional supplier agreement** used to demonstrate that branch; it is not claimed to be printed in the quotation. Payment proofs, invoices and signed acknowledgements are demonstration evidence, not actual payments or deliveries. Source opening stock is also a demonstration fixture.

## Isolation and reproduction

An isolated browser profile displays connected snapshots advanced through the real domain commands. No app labels or layouts are altered for screenshots. Existing browser data, the original 36 screenshots, and Google Docs are preserved. Successful actions and their resulting states are separate figures where useful; no full-page or stitched images are used.

Run `node scripts/test-mrf372-samples.mjs` to refresh live extraction results, `node scripts/capture-core-business-flow.mjs --mrf372` to capture, `node scripts/core-flow-contact-sheet.mjs --mrf372` for the contact sheet, then `python scripts/package-detailed-screenshots.py` to validate and package. The local app must be running at port 3000; `CORE_FLOW_APP_URL` overrides its address.
''', encoding='utf-8')
validation['pngValidation'] = {'passed': True, 'count': len(entries), 'uniqueImages': len(hashes), 'width': 1440, 'height': 900}
validation['processGroups'] = {group: sum(e['group'] == group for e in entries) for group in groups}
(root / 'VALIDATION.json').write_text(json.dumps(validation, indent=2), encoding='utf-8')
(root / 'manifest.json').write_text(json.dumps(entries, indent=2), encoding='utf-8')
archive_path = root / 'mrf372-detailed-screenshots.zip'
with zipfile.ZipFile(archive_path, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name in ['README.md', 'FIGURE_INDEX.md', 'FIGURE_CAPTIONS.csv', 'index.html', 'manifest.json', 'VALIDATION.json', 'SAMPLE_TEST_RESULTS.json', 'CONTACT_SHEET.png']:
        if (root / name).exists():
            archive.write(root / name, name)
    for entry in entries:
        archive.write(root / entry['file'], entry['file'])
with zipfile.ZipFile(archive_path) as archive:
    assert archive.testzip() is None
print(json.dumps({'figures': len(entries), 'groups': len(groups), 'unique': len(hashes), 'zipBytes': archive_path.stat().st_size}))
