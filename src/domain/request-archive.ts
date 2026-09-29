import type { MRF } from "./types.ts";

export const supportingPdf = (request: MRF) => request.documents.find(document => document.type === "Supporting PDF" && !!document.fileId);

export const procurementReady = (request: MRF | undefined): request is MRF => !!request && request.status === "approved" && !request.correction && (!request.archive || request.archive.status === "complete");
