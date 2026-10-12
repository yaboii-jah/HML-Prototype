# ConstructSync core ERD

Version 6.0 · 2026-10-11 · **one figure, 10 entities**.

This simplified core ERD describes the intended production application as a proposed relational model. Supporting document, audit and history tables are omitted. Its design assumes authenticated users and shared persistent records; browser-local prototype storage is not its basis. See the [production design basis](../PRODUCTION_DESIGN.md).

## Use in the paper

Use [PDF](constructsync-erd.pdf) or [SVG](constructsync-erd.svg) for selectable vector text, or [PNG](constructsync-erd.png) for Word/Google Docs. Insert at **16 cm wide or larger**, without cropping; field text is 8.13 pt at 16 cm. The figure measures 160 × 143.33 mm. Increasing width to 18 cm makes text approximately 9.14 pt. The single-page PDF uses the figure's actual physical size.

The figure contains only tables and unlabeled Crow's Foot connectors. Each table retains its distinct header color. The legend, numeric connector labels and diagram title are omitted. Tables are rearranged to use the former legend space and reduce the figure height. Add any paper caption separately.

## Read the relationships

- **1:N** — one-to-many; a parent can have zero or many children.
- **0..1:N** — a stock movement may omit its delivery source; a delivery can supply many stock movements.
- PK = primary key; FK = foreign key. Crow's Foot symbols preserve endpoint cardinalities. Dashed connectors represent non-identifying relationships.
- Line crossings have no junction meaning. Follow the endpoints to the named boxes. Each table has its own header color; colors identify tables and carry no cardinality meaning.

MRF Item keeps requested materials visible. Finance scheduling is summarized on the PO; Accounting records Verified Payment. The planned payment date is separate from the agreed due date. Detailed offered, ordered and delivered lines are omitted from the figure. [Entity and relationship notes](DATA_DICTIONARY.md) describe invariants and omitted supporting detail.

## Regenerate

[model.mjs](model.mjs) defines the entities, fields, cardinalities, colors and fixed publication positions. [Mermaid source](constructsync-erd.mmd) has identical fields and endpoint cardinalities; its automatic renderer may position boxes differently. The publication exporter uses fixed routes for print readability. [VALIDATION.md](VALIDATION.md) records checks.

```powershell
node docs/thesis/erd/generate.mjs
node docs/thesis/erd/generate.mjs --check
node docs/thesis/erd/export.mjs --cli "PATH_TO_CACHED_MERMAID_CLI/src/cli.js"
```

The exporter reuses Puppeteer from the installed Mermaid CLI package and Edge from puppeteer-config.json. The SVG creates the PNG and PDF. Application dependencies do not change.
