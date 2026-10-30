// Maintained source of truth. Live provider checks belong to test:live.
export const deferredPrototypeSuites = [
  'showcase', 'shell-controls', 'register', 'user-management', 'site-visibility',
  'skeleton-loading', 'browser', 'quotation', 'compare-allocate', 'full-disbursement',
  'credit-terms', 'site-stock-transfers', 'stock-transfer-forwarding',
  'delivery-documents', 'document-gallery', 'quotation-editor', 'quotation-worksheet',
  'supplier-upload', 'quotation-financial-review', 'quotation-extraction',
  'quotation-confirmations', 'suggestions', 'project-folder', 'document-numbering',
  'material-rows', 'qa-fixes', 'usage-entries', 'next-iteration',
];

// Offline checks exercise the supported public runtime; real sessions run in
// disposable Supabase CI. Deferred workflows are recorded in the tracker.
export const browserSuites = ['foundation-public'];
