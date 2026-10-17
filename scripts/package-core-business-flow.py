"""Validate and package only the separate business-flow figure set."""
import csv
import hashlib
import html
import json
from pathlib import Path
import shutil
import struct
import zipfile

root = Path(__file__).resolve().parent.parent / 'artifacts' / 'core-business-flow'
entries = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
entries.sort(key=lambda item: item['number'])
request_refs = {entry['route'].split('/quotes')[0].split('/edit')[0]: entry['refs']['mrf'] for entry in entries if entry['route'].startswith('/requests/') and entry['refs'].get('mrf')}
for entry in entries:
    key = entry['route'].split('/quotes')[0].split('/edit')[0]
    if key in request_refs:
        entry['refs'].setdefault('mrf', request_refs[key])
assert 30 <= len(entries) <= 36, 'Expected 30-36 workflow figures'
assert [entry['number'] for entry in entries] == list(range(1, len(entries) + 1))
validation = json.loads((root / 'VALIDATION.json').read_text(encoding='utf-8'))
assert len(entries) == validation['expected'] == validation['captured']
assert not validation['browserExceptions'] and not validation['externalDriveRequests']
digests = set()
for entry in entries:
    relative = Path(entry['file'])
    assert not relative.is_absolute() and '..' not in relative.parts
    data = (root / relative).read_bytes()
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    assert struct.unpack('>II', data[16:24]) == (1440, 900)
    digest = hashlib.sha256(data).hexdigest()
    assert digest not in digests, f"Duplicate image: {entry['file']}"
    digests.add(digest)
    entry['sha256'] = digest
    entry.pop('visibleText', None)

# Retain superseded captures outside the review folder so only final figures appear.
retained = {entry['file'] for entry in entries}
backup = root.parent.parent / '.next' / 'core-flow-superseded'
for candidate in (root / 'screenshots').glob('*.png'):
    if candidate.relative_to(root).as_posix() not in retained:
        assert candidate.resolve().parent == (root / 'screenshots').resolve()
        backup.mkdir(parents=True, exist_ok=True)
        shutil.move(str(candidate), str(backup / candidate.name))

intro = ('# ConstructSync Core Business Flow Figures\n\n'
         f'**{len(entries)} screenshots · 1440 × 900 · light theme.**\n\n'
         'This collection follows one connected upfront purchase, one credit purchase, '
         'and one site stock transfer. Shared purchasing steps appear once. '
         'Core figures explain the process; supporting figures provide additional detail '
         'and may be omitted from the final paper. Collection numbers are suggested '
         'ordering, not final thesis figure numbers.\n\n'
         '[Open visual gallery](index.html) · [Caption spreadsheet](FIGURE_CAPTIONS.csv) '
         '· [Validation](VALIDATION.json)\n\n')
lines = []
for entry in entries:
    refs = '; '.join(f'{key.upper()}: {value}' for key, value in entry['refs'].items())
    lines.append(f"### {entry['caption']}\n\n"
                 f"**{entry['importance'].title()} · {entry['role']}**\n\n"
                 f"{entry['purpose']}\n\n{refs}\n\n"
                 f"[View screenshot]({entry['file']})\n")
(root / 'FIGURE_INDEX.md').write_text(intro + '\n'.join(lines), encoding='utf-8')
with (root / 'FIGURE_CAPTIONS.csv').open('w', encoding='utf-8-sig', newline='') as handle:
    writer = csv.writer(handle)
    writer.writerow(['Order', 'Suggested Figure Caption', 'Priority', 'Role', 'Purpose', 'Record References', 'Filename'])
    for entry in entries:
        writer.writerow([entry['number'], entry['caption'], entry['importance'], entry['role'], entry['purpose'], '; '.join(f'{key}: {value}' for key, value in entry['refs'].items()), entry['file']])

escape = html.escape
cards = []
for entry in entries:
    refs = ' · '.join(entry['refs'].values())
    cards.append(f'<figure data-priority="{entry["importance"]}"><a href="{escape(entry["file"])}" target="_blank">'
                 f'<img loading="lazy" src="{escape(entry["file"])}" alt="{escape(entry["title"])}"></a>'
                 f'<figcaption><span class="tag">{escape(entry["importance"])}</span> '
                 f'<strong>{escape(entry["caption"])}</strong><p>{escape(entry["purpose"])}</p>'
                 f'<small>{escape(entry["role"])} · {escape(refs)}</small></figcaption></figure>')
(root / 'index.html').write_text('''<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>ConstructSync Business Flow Figures</title>
<style>body{font:16px/1.5 Arial,sans-serif;margin:32px;background:#f3f6fb;color:#17243a}h1{margin-bottom:8px}
nav{display:flex;gap:12px;margin:24px 0;flex-wrap:wrap}button,a.download{padding:10px 16px;border:1px solid #bdcee4;border-radius:7px;background:white;color:#164a8c;cursor:pointer;text-decoration:none}
main{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,480px),1fr));gap:24px}figure{margin:0;background:white;border:1px solid #d9e2ee;border-radius:10px;overflow:hidden}img{width:100%;display:block}figcaption{padding:18px}strong{display:block;font-size:18px}.tag{text-transform:uppercase;font-size:11px;color:#28538b;font-weight:bold}small{color:#52627a}figure[hidden]{display:none}</style>
<h1>ConstructSync Core Business Flow</h1><p>36 screenshots following connected upfront, credit/terms and stock-transfer examples. Click an image for its original size.</p>
<nav><button onclick="filter('all')">All figures</button><button onclick="filter('core')">Core only</button><button onclick="filter('supporting')">Supporting only</button><a class="download" href="FIGURE_CAPTIONS.csv">Download captions</a><a class="download" href="FIGURE_INDEX.md">Figure index</a></nav><main>'''
    + ''.join(cards) + '''</main><script>function filter(value){for(const figure of document.querySelectorAll('figure'))figure.hidden=value!=='all'&&figure.dataset.priority!==value}</script></html>''', encoding='utf-8')
(root / 'README.md').write_text(intro + '''## Process order

Project and scope budgets → MRF → Project Manager approval → Procurement stock check → Quotation review → Supplier comparison and awards → PO preparation → Accounting review.

Upfront: PO issuance → Finance coordination → Accounting payment verification → Delivery clearance → Logistics → Site receiving → Stock posting → Document review → Usage.

Credit: Agreed due date → Delivery clearance while unpaid → Verified installment → Verified settlement. Shared receiving steps follow the upfront example.

Transfer: Matching source stock → Source approval → Trip scheduling → Dispatch/source deduction → Destination receiving → Destination posting → Accounting evidence review.

## Capture method and limits

The native app is captured in an isolated browser profile. Connected fictional records progress through the app's domain commands; their snapshots are displayed through the normal role interfaces. No screenshot changes application text or layout. Real local PDF bytes support the fictional archived documents. Existing app data, earlier screenshots, and Google Docs are preserved.

Each image is a separate viewport capture. The collection demonstrates successful business processes, rather than every page, field, role, pagination page, or exception. Figure titles describe the stage shown; screenshots containing action buttons show the step before confirmation. Finance coordinates payment; Accounting verifies it. Transfer stock is deducted on dispatch and posted at the destination after receipt.

Reproduce with `node scripts/capture-core-business-flow.mjs`, then `python scripts/package-core-business-flow.py`. The app must be running at `http://127.0.0.1:3000` (override with `CORE_FLOW_APP_URL`).
''', encoding='utf-8')
(root / 'manifest.json').write_text(json.dumps(entries, indent=2), encoding='utf-8')
validation['pngValidation'] = {'passed': True, 'count': len(entries), 'uniqueImages': len(digests), 'width': 1440, 'height': 900}
validation['coreFigures'] = sum(entry['importance'] == 'core' for entry in entries)
validation['supportingFigures'] = sum(entry['importance'] == 'supporting' for entry in entries)
(root / 'VALIDATION.json').write_text(json.dumps(validation, indent=2), encoding='utf-8')
with zipfile.ZipFile(root / 'core-business-flow-screenshots.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    for relative in ['README.md', 'FIGURE_INDEX.md', 'FIGURE_CAPTIONS.csv', 'index.html', 'manifest.json', 'VALIDATION.json']:
        archive.write(root / relative, relative)
    for entry in entries:
        archive.write(root / entry['file'], entry['file'])
    if (root / 'CONTACT_SHEET.png').exists():
        archive.write(root / 'CONTACT_SHEET.png', 'CONTACT_SHEET.png')
with zipfile.ZipFile(root / 'core-business-flow-screenshots.zip') as archive:
    assert archive.testzip() is None, 'ZIP integrity check failed'
print(json.dumps({'figures': len(entries), 'uniqueImages': len(digests), 'core': sum(e['importance'] == 'core' for e in entries), 'supporting': sum(e['importance'] == 'supporting' for e in entries), 'zipBytes': (root / 'core-business-flow-screenshots.zip').stat().st_size}))
