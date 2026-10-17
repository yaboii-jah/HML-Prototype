# Populated demonstration workspace

Open the app normally. The dataset installs automatically once in each browser, including on the deployed app. Existing accounts and passwords remain usable. Later edits are preserved; there is no reload-data button or recurring replacement.

| Records | Initial contents |
|---|---|
| Projects | 5 fictional Philippine projects with budgets, document codes and all 10 scope categories |
| Suppliers | 10 fictional suppliers |
| MRFs | 30, covering drafts, submitted, returned, rejected and approved requests |
| Quotations | 52 reviewed or review-ready supplier offers |
| Purchase orders | 45, spanning drafts, Accounting reviews, holds, returns, approvals and released orders, including fully paid and completed examples |
| Supplier delivery batches | 37, including company-warehouse receipt and onward deliveries |
| Inventory | 60 project/material balances, with opening stock, low/out-of-stock positions, posted receipts and usage |
| Stock transfers | 4 at source-review, scheduling, receiving and document-review stages |
| Comparison reports | 2, each with a working PDF and XLSX |

Dates are relative to the installation day. Active Site Personnel accounts receive all five project assignments. Names, emails, passwords and other department roles are preserved; changed Site Personnel assignments follow the existing session-revision rules.

## Walkthrough

- **Site Personnel:** Open Dashboard, Material requests, Deliveries and Inventory. Resume a draft, revise a returned request, receive a dispatched batch or confirm a pending source release. Budget figures remain hidden.
- **Project Manager:** Open a submitted MRF, approve it and wait for its local form/supporting-document archive. Review project scopes and funding.
- **Procurement:** Open an approved request without full PO coverage. Check other-project stock, review the prepared quotation draft, compare offers or prepare another PO within remaining quantities. Approved unissued POs are ready for supplier issuance.
- **Accounting:** Open an issued upfront PO awaiting payment proof. Attach a PDF/image, verify the full payment and confirm delivery clearance. On a credit PO, attach proof and verify a partial payment independently of delivery. Review invoice/receipt evidence and retry a pending transfer receipt archive.
- **Finance:** Open payment coordination. The dataset includes scheduled, processing, delayed and overdue supplier balances.
- **Logistics:** Schedule a ready PO, dispatch a scheduled supplier batch or transfer trip, and inspect company-warehouse forwarding.
- **Administrator:** Inspect projects, scopes, account assignments, exception queues and activity.

## Documents and integrations

Seeded PDFs contain the relevant fictional references, descriptions, quantities and payment information, with a demonstration-copy footer. Comparison files use the normal report generators. New MRF, PO, comparison, receipt and evidence archive actions use actual local copies in IndexedDB. Persistent `/demo-files/[fileId]` links provide access-checked viewing/downloads after reload.

Project settings identify local archiving; project documents can be searched without contacting Google Drive. No Drive folder IDs, successful uploads or remote links are fabricated. New projects within this workspace also use local archives. Workspaces without demonstration metadata retain the original Drive integration. AI extraction for new uploads is unchanged; manual entry remains available.

## Replacement, recovery and clearing

Before replacement, the installer backs up existing workspace storage, the complete user directory and original uploaded blobs in the separate IndexedDB database `hml-constructsync-showcase-backups`. The installation marker `hml-constructsync-showcase-installed-v1` records its `backupId`. The backup stays in the same browser and is retained when clearing the active workspace.

Files are staged before publishing new records. A failed publish restores the previous records; interrupted installs restore their journal's backup before retrying. If installation cannot complete, the app shows its recovery state and preserves the backup. Reload after addressing the reported storage/network problem to retry.

For manual recovery, use DevTools in the originating browser:

```js
const marker = JSON.parse(localStorage.getItem('hml-constructsync-showcase-installed-v1'));
const open = name => new Promise((resolve, reject) => {
  const request = indexedDB.open(name, 1);
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
const backups = await open('hml-constructsync-showcase-backups');
const backup = await new Promise((resolve, reject) => {
  const request = backups.transaction('backups').objectStore('backups').get(marker.backupId);
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
backups.close();
if (!backup) throw new Error('The original backup is unavailable in this browser.');
const files = await open('hml-quotation-files');
await new Promise((resolve, reject) => {
  const transaction = files.transaction('files', 'readwrite');
  for (const file of backup.files) transaction.objectStore('files').put(file.blob, file.id);
  transaction.oncomplete = resolve;
  transaction.onerror = () => reject(transaction.error);
});
files.close();
for (const key of Object.keys(localStorage)) {
  if (/^hml-(constructsync|buildsync)-demo-v\d+$/.test(key)) localStorage.removeItem(key);
}
for (const [key, raw] of backup.records) localStorage.setItem(key, raw);
localStorage.setItem('hml-constructsync-users-v1', backup.directory);
localStorage.setItem('hml-constructsync-showcase-installed-v1', JSON.stringify({ restored: true, backupId: backup.id }));
localStorage.removeItem('hml-constructsync-showcase-installing-v1');
location.reload();
```

The normal Clear workspace action is temporarily hidden, and `/admin/maintenance` redirects to Administration. The internal reset operation remains available for workspace recovery; it removes active records and files, preserves accounts and backups, and leaves the workspace empty without reseeding. Clearing all browser site storage also removes the installation marker, so a later visit is a fresh installation.

## Verification

`npm test` includes dataset validity, budget/stock reconciliation, actionable role queues, archive namespace validation and document access/operation isolation. Run `node --experimental-strip-types scripts/showcase-smoke.mjs http://127.0.0.1:3000` for automatic installation, documents, department screens, live archive/payment actions, backup preservation, interruption recovery, storage rollback and clearing without reseeding.
