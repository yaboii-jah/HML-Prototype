"""Validate and package the isolated 16-figure capstone collection."""
import csv
import hashlib
import html
import json
from pathlib import Path
import shutil
import struct
import zipfile

workspace = Path(__file__).resolve().parent.parent
root = workspace / 'artifacts' / 'capstone-key-modules'
entries = sorted(json.loads((root / 'manifest.json').read_text(encoding='utf-8')), key=lambda item: item['number'])
validation = json.loads((root / 'VALIDATION.json').read_text(encoding='utf-8'))
assert len(entries) == validation['captured'] == validation['expected'] == 16
assert [item['number'] for item in entries] == list(range(1, 17))
assert validation['capturedThisRun'] == list(range(1, 17)), 'Capture the complete final collection before packaging'
primary = [item for item in entries if item['importance'] == 'primary']
assert len(primary) == len({item['module'] for item in primary}) == 12
assert not validation['browserExceptions'] and not validation['externalDriveRequests']
assert validation['sampleImportTests']['passed']
assert validation['sampleImportTests']['method'] == 'manual-pdf-review'
assert validation['scenarios']['consumptionReconciles']
assert validation['scenarios']['usageRetryIdempotent']
assert validation['visualReview']['passed']
assert validation['visualReview']['figures'] == list(range(1, 17))
digests = set()
for entry in entries:
    relative = Path(entry['file'])
    assert not relative.is_absolute() and '..' not in relative.parts
    assert (root / relative).resolve().is_relative_to((root / 'screenshots').resolve())
    data = (root / relative).read_bytes()
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    assert struct.unpack('>II', data[16:24]) == (3200, 2000), relative
    digest = hashlib.sha256(data).hexdigest()
    assert validation['visualReview']['sha256ByFigure'][str(entry['number'])] == digest, 'Review the current image bytes before packaging'
    assert digest not in digests, f'Duplicate image: {relative}'
    digests.add(digest)
    entry['sha256'] = digest
    entry['pixels'] = {'width': 3200, 'height': 2000}
    for expected in entry['expectedText']:
        if 'visibleText' in entry:
            assert expected in entry['visibleText'], f'{relative}: missing {expected}'
    entry.pop('visibleText', None)

retained = {entry['file'] for entry in entries}
for candidate in (root / 'screenshots').rglob('*.png'):
    if candidate.relative_to(root).as_posix() not in retained:
        assert candidate.resolve().is_relative_to((root / 'screenshots').resolve())
        destination = workspace / '.next' / 'capstone-superseded' / candidate.name
        assert destination.resolve().is_relative_to((workspace / '.next').resolve())
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(candidate), str(destination))

source_files = validation['sampleImportTests']['files']
for source in source_files:
    assert hashlib.sha256((workspace / source['file']).read_bytes()).hexdigest() == source['sha256'], source['file']
assert [source['verifiedGross'] for source in source_files[1:]] == [438680, 451548, 425900, 414242]

intro = '''# ConstructSync — Key Module Screenshots

**16 figures · 12 primary modules + 4 supporting views · light theme**

Each PNG is a native desktop viewport screenshot at 3200 × 2000 pixels. Most use a 1600 × 1000 CSS viewport at 2× pixel density; the comparison uses 2000 × 1250 at 1.6× density. Its native horizontal scroll is positioned at the winning supplier and saved-award columns. Numbering gives collection order; assign final thesis figure numbers in the paper.

[Visual gallery](index.html) · [Figure captions](FIGURE_CAPTIONS.csv) · [Figure index](FIGURE_INDEX.md) · [Validation](VALIDATION.json)

'''
index = intro + '| Figure | Module | Department | Suggested caption |\n|---|---|---|---|\n'
for item in entries:
    index += f"| {item['number']} | {item['module']} | {item['role']} | [{item['title']}]({item['file']}) |\n"
index += '\n## Suggested paper descriptions\n\n'
for item in entries:
    index += f"**{item['caption']}**\n\n{item['purpose']}\n\n"
(root / 'FIGURE_INDEX.md').write_text(index, encoding='utf-8')
with (root / 'FIGURE_CAPTIONS.csv').open('w', encoding='utf-8-sig', newline='') as handle:
    writer = csv.writer(handle)
    writer.writerow(['Collection order', 'Module', 'Coverage', 'Department', 'Suggested figure caption', 'Suggested paper description', 'Record references', 'PNG path'])
    for item in entries:
        writer.writerow([item['number'], item['module'], item['importance'], item['role'], item['caption'], item['purpose'], '; '.join(f'{key}: {value}' for key, value in item['refs'].items()), item['file']])

readme = intro + '''## Data and test provenance

All figures follow the original MRF 372 and the four supplier quotation PDFs in `sample-data/`. The source PDFs are read without modification. Reviewed manual inputs are checked against their printed text, including the eight requested materials, quantities, units, prices, line amounts, VAT-inclusive treatment and quotation totals. Source hashes appear in `SAMPLE_TEST_RESULTS.json`. This run does not test live AI extraction or Google Drive.

The application assigns MSR-MRF-0001 while retaining MRF-372 as the source reference. Kestrel supplies seven materials through an upfront PO; Apex supplies 56 glass clamps through a credit PO. Four more clamps come from a source project, leaving 16 of its initial 20 clamps. One grouped usage entry consumes two 900 × 2100mm glass panels and one silicone cartridge, leaving 10 panels and 23 cartridges. Destination clamp stock is 60. Consumption reconciles all nine project/material rows with the stock ledger, and retrying the saved usage command creates no second deduction.

The original quotations specify 30-day terms. The Kestrel upfront arrangement is a subsequent fictional supplier agreement used to illustrate that branch. Project allocations, source opening stock, payment proofs, invoices and receiving acknowledgements are supplemental demonstration fixtures. Screenshots show different documented stages of one connected example; they are not all from its final state.

## Capture and selection

The isolated Edge profile uses the normal app screens and named department accounts. Record snapshots progress through the app's domain commands. Original supplier PDFs appear in the native source viewer, and generated company documents use the app's existing generators. Screenshots use native controls, scrolling and filters, with no altered application labels or layout. Existing browser workspaces and earlier figure collections are preserved.

Figures 1–12 each represent one module. Figures 13–16 show quotation review, comparative bidding, grouped usage and consumption. Administration shows a user editor and project assignments; no password or reset form is captured. Supporting files explain simulated transactions so the paper can distinguish screenshot evidence from live integration testing.

Tables and worksheets retain representative visible rows within their native scrolling areas. The comparative bid is scrolled to the winning supplier and saved-award columns; other offers remain accessible in the application. These are separate viewport screenshots, without stitching or layout changes.

## Reproduce

With the app running locally at `http://127.0.0.1:3000`:

```powershell
node --experimental-strip-types scripts/capstone-module-scenarios.mjs --validate-scenario
node --experimental-strip-types scripts/capture-core-business-flow.mjs --capstone
python scripts/package-capstone-figures.py
```

`CORE_FLOW_APP_URL` overrides the app address. Sample verification requires no temporary extraction cache or AI credentials. PNG files, captions, gallery links, unique images, module coverage and source hashes are verified during packaging. Visual review of all 16 images is recorded in `VALIDATION.json`.
'''
(root / 'README.md').write_text(readme, encoding='utf-8')
escape = html.escape
cards = []
for item in entries:
    file = escape(item['file'], quote=True)
    cards.append(f'''<figure data-coverage="{item['importance']}"><a href="{file}" target="_blank" rel="noopener"><img loading="lazy" width="3200" height="2000" src="{file}" alt="{escape(item['title'], quote=True)}"></a><figcaption><small>{escape(item['module'])} · {escape(item['role'])} · {item['importance']}</small><h2>{escape(item['caption'])}</h2><p>{escape(item['purpose'])}</p><a href="{file}" download>Download full-resolution PNG</a></figcaption></figure>''')
(root / 'index.html').write_text('''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ConstructSync Capstone Figures</title><style>
*{box-sizing:border-box}body{font:16px/1.55 Arial,sans-serif;margin:32px;background:#f4f7fb;color:#17283d}header{max-width:1000px;margin-bottom:28px}h1{font-size:30px;margin:0 0 10px}h2{font-size:18px;line-height:1.4;margin:10px 0}nav{display:flex;gap:18px;flex-wrap:wrap;margin:20px 0}a{color:#24549a}select{font:inherit;padding:8px;border:1px solid #bdcee4;border-radius:5px;background:white}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,600px),1fr));gap:24px}figure{margin:0;background:#fff;border:1px solid #d9e2ee;border-radius:8px;overflow:hidden}img{display:block;width:100%;height:auto}figcaption{padding:20px}small{color:#52627a}figure[hidden]{display:none}@media(max-width:600px){body{margin:16px}}@media print{main{display:block}figure{break-inside:avoid;page-break-after:always}header,nav,figcaption>a{display:none}}</style>
<header><h1>ConstructSync — Key Module Screenshots</h1><p>16 curated figures covering 12 modules and four supporting features, using the MRF 372 sample pack. Click an image to inspect its full-resolution PNG.</p><nav><a href="capstone-key-modules.zip">Download collection ZIP</a><a href="FIGURE_CAPTIONS.csv">Captions and descriptions</a><a href="FIGURE_INDEX.md">Figure index</a><a href="README.md">Data and testing notes</a></nav><label>Show <select id="coverage"><option value="all">All 16 figures</option><option value="primary">12 primary module figures</option><option value="supporting">4 supporting feature figures</option></select></label></header><main>'''
    + ''.join(cards) + '''</main><script>document.getElementById('coverage').addEventListener('change',event=>{for(const figure of document.querySelectorAll('figure'))figure.hidden=event.target.value!=='all'&&figure.dataset.coverage!==event.target.value})</script></html>''', encoding='utf-8')
validation['pngValidation'] = {'passed': True, 'count': 16, 'uniqueImages': 16, 'width': 3200, 'height': 2000}
validation['moduleCoverage'] = {item['module']: [entry['number'] for entry in entries if entry['module'] == item['module']] for item in primary}
validation['sourceFilesUnchanged'] = True
sample_summary = {'passed': True, 'method': 'Manual inputs verified against the original PDF text; no live AI extraction', 'files': source_files, 'checks': ['Eight MRF materials and matching supplier lines', 'Descriptions, quantities and units', 'Unit prices and printed line amounts', 'VAT-inclusive treatment and four gross totals', 'Original source bytes and SHA-256 hashes']}
(root / 'SAMPLE_TEST_RESULTS.json').write_text(json.dumps(sample_summary, indent=2), encoding='utf-8')
(root / 'VALIDATION.json').write_text(json.dumps(validation, indent=2), encoding='utf-8')
(root / 'manifest.json').write_text(json.dumps(entries, indent=2), encoding='utf-8')
names = ['README.md', 'FIGURE_INDEX.md', 'FIGURE_CAPTIONS.csv', 'index.html', 'manifest.json', 'VALIDATION.json', 'SAMPLE_TEST_RESULTS.json']
names += [entry['file'] for entry in entries]
archive_path = root / 'capstone-key-modules.zip'
with zipfile.ZipFile(archive_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for name in names:
        archive.write(root / name, name)
with zipfile.ZipFile(archive_path) as archive:
    assert archive.testzip() is None
    assert len(archive.namelist()) == len(names)
    assert sum(name.endswith('.png') for name in archive.namelist()) == 16
print(json.dumps({'figures': len(entries), 'primaryModules': len(primary), 'uniqueImages': len(digests), 'sourceHashesVerified': len(source_files), 'zipBytes': archive_path.stat().st_size}))
