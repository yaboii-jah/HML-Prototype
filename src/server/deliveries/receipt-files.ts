import 'server-only';
import { createHash } from 'node:crypto';
import { start } from 'workflow/api';
import { record } from '@/src/domain/projects/projects';
import { QUOTE_CHUNK_SIZE, QUOTE_MIMES, quoteUuid, validQuoteFile } from '@/src/domain/quotations/drafts';
import { documentRange } from '@/src/domain/requests/documents';
import { parseDeliveryPlan, parseDeparture, parseReceiptSnapshot } from '@/src/domain/deliveries/contracts';
import { serviceRpc } from '@/src/server/auth/service-rpc';
import { documentActor, DocumentHttpError, privateDocumentRead } from '@/src/server/documents/access';
import { documentDrive } from '@/src/server/documents/config';
import { rowValue, textValue } from '@/src/server/documents/state';
import { validateQuotationOriginal } from '@/src/server/quotations/original-validation';
import { openUploadTicket, sealUploadTicket } from '@/src/server/upload-ticket-codec';
import { renderReceiptPdf } from '@/src/server/delivery-receipt-pdf';
import { deliveryReceiptWorkflow, transferReceiptWorkflow } from '@/src/server/workflows/delivery-receipts';

type Actor = Awaited<ReturnType<typeof documentActor>>;
function receiptRpc(action: string, options: { actor?: Actor; id?: string; version?: string; lease?: string; patch?: Record<string, unknown> }, transfer = false) {
  return serviceRpc(transfer ? 'transfer_receipt_file' : 'delivery_receipt_file', {
    actor:options.actor ?? null, file_id:options.id ?? null, version_id:options.version ?? null,
    action, lease:options.lease ?? null, patch:options.patch ?? {},
  });
}

function tags(id: string, version: string, transfer: boolean): Record<string, string> {
  return transfer ? { hmlTransferReceiptFile:id, hmlTransferReceiptVersion:version } : { hmlReceiptFile:id, hmlReceiptVersion:version };
}

export async function enqueueReceiptFile(id: string, transfer = false) {
  if (process.env.GOOGLE_DRIVE_ENABLED !== 'true') return;
  if (transfer) await start(transferReceiptWorkflow, [id]);
  else await start(deliveryReceiptWorkflow, [id]);
}

function bindReceiptRpc(transfer: boolean) {
  return (action: string, options: Parameters<typeof receiptRpc>[1]) => receiptRpc(action, options, transfer);
}

export async function receiptFileCommand(input: unknown, actor: Actor) {
  const rpc = bindReceiptRpc(false);
  if (process.env.GOOGLE_DRIVE_ENABLED !== 'true') throw new DocumentHttpError(503, 'Drive is unavailable. The receipt and any posted stock are saved.');
  const command = record(input);
  if (!command || !quoteUuid(command.versionId)) throw new DocumentHttpError(400, 'Choose the current receipt.');
  if (command.type === 'retry' && (command.kind === 'generated' || command.kind === 'signed')) {
    const result = record(await rpc('retryVersion', { actor, version:command.versionId, patch:{ kind:command.kind } }));
    if (quoteUuid(result?.id)) await enqueueReceiptFile(result.id);
    return { queued:!!result };
  }
  if (command.type !== 'begin' || !validQuoteFile(command.file)) throw new DocumentHttpError(400, 'Choose a readable PDF, JPEG, PNG or WebP up to 20 MiB.');
  const { name, size, mime, sha256 } = command.file;
  return rpc('begin', { actor, version:command.versionId, patch:{ name, size, mime, sha256 } });
}

export async function transferFileCommand(input: unknown, actor: Actor) {
  const command = record(input);
  if (command?.type === 'withdraw' && quoteUuid(command.id)) {
    await receiptRpc('withdraw', { actor, id:command.id }, true);
    return { withdrawn:true };
  }
  if (process.env.GOOGLE_DRIVE_ENABLED !== 'true') {
    throw new DocumentHttpError(503, 'Drive is unavailable. The receipt and any posted stock are saved.');
  }
  if (command?.type === 'retry' && quoteUuid(command.id)) {
    await receiptRpc('retryFile', { actor, id:command.id }, true);
    await enqueueReceiptFile(command.id, true);
    return { queued:true };
  }
  if (command?.type !== 'begin' || !quoteUuid(command.versionId) || !validQuoteFile(command.file)
    || (command.kind !== 'signed' && command.kind !== 'supporting')
    || (command.replacesId != null && !quoteUuid(command.replacesId))
    || (command.resumeId != null && (!quoteUuid(command.resumeId) || command.replacesId != null))) {
    throw new DocumentHttpError(400, 'Choose a PDF, JPEG, PNG or WebP up to 20 MiB.');
  }
  const { name, size, mime, sha256 } = command.file;
  return receiptRpc('begin', { actor, version:command.versionId,
    patch:{ name, size, mime, sha256, kind:command.kind, replacesId:command.replacesId, resumeId:command.resumeId } }, true);
}

export async function transferReceiptFile(id: string, chunk: Uint8Array, offset: number, actor: Actor, transfer = false) {
  const rpc = bindReceiptRpc(transfer);
  let file = rowValue(await rpc('uploadClaim', { actor, id }));
  if (file.state === 'processing' || file.state === 'complete') {
    if (file.state === 'processing') await enqueueReceiptFile(id, transfer).catch(() => {});
    return { offset:Number(file.offset_bytes), state:file.state };
  }
  const lease = textValue(file.lease_id);
  const update = async (patch: Record<string, unknown>) => {
    file = rowValue(await rpc('uploadCheckpoint', { actor, id, lease, patch }));
  };
  const expire = async () => {
    await rpc('uploadExpired', { actor, id, lease });
    throw new DocumentHttpError(410, 'The upload expired. Reselect the original to start a new upload.');
  };
  try {
    const drive = documentDrive();
    const folder = textValue(file.folder_id), size = Number(file.size), mime = textValue(file.mime);
    const identity = tags(id, textValue(file.version_id), transfer);
    await drive.validateFolder(folder, textValue(file.root_id));
    if (!file.drive_id) await update({ driveId:await drive.generateId() });
    const providerId = textValue(file.drive_id);
    const finish = async () => {
      await rpc('uploadFinish', { actor, id, lease });
      await enqueueReceiptFile(id, transfer).catch(() => {});
      return { offset:size, state:'processing' };
    };
    const existing = await drive.find(providerId);
    if (existing) {
      drive.verifyIdentity(existing, folder, identity, mime);
      if (existing.size === String(size)) return await finish();
    }
    let uri = file.session_ticket
      ? openUploadTicket<{ id: string; uri: string }>(textValue(file.session_ticket),
        value => value.id === id && drive.validSession(value.uri), 'Invalid receipt upload session.').uri
      : null;
    if (!uri) {
      uri = await drive.begin(providerId, folder, textValue(file.name), size, identity, mime);
      if (!uri) throw Error('Drive did not confirm the upload session.');
      await update({ ticket:sealUploadTicket({ id, uri }) });
    }
    let progress = await drive.transfer(uri, size, undefined, 0, mime);
    if (progress.expired || progress.offset < Number(file.offset_bytes)) return await expire();
    if (progress.complete) return await finish();
    if (offset !== progress.offset) return { offset:progress.offset, state:'uploading' };
    if (offset + chunk.length > size || (offset + chunk.length < size && chunk.length % (256 * 1024))) {
      throw new DocumentHttpError(400, 'Invalid signed-evidence chunk.');
    }
    progress = await drive.transfer(uri, size, chunk, offset, mime);
    if (progress.expired) return await expire();
    if (progress.complete) return await finish();
    await update({ offset:progress.offset });
    return { offset:progress.offset, state:'uploading' };
  } finally {
    await rpc('uploadRelease', { actor, id, lease }).catch(() => {});
  }
}

export async function processDeliveryReceiptFile(id: string, transfer = false) {
  const rpc = bindReceiptRpc(transfer);
  const file = record(await rpc('workerClaim', { id }));
  if (!file) return;
  const lease = textValue(file.lease_id);
  try {
    const drive = documentDrive();
    const folder = textValue(file.folder_id), identity = tags(id, textValue(file.version_id), transfer), mime = textValue(file.mime);
    await drive.validateFolder(folder, textValue(file.root_id));
    let providerId = typeof file.drive_id === 'string' ? file.drive_id : '';
    let size = Number(file.size), sha256 = String(file.sha256 ?? '');
    if (file.kind === 'generated') {
      const snapshot = parseReceiptSnapshot(file.snapshot);
      const plan = parseDeliveryPlan(record(file.snapshot)?.plan);
      const departure = parseDeparture(record(file.snapshot)?.departure);
      const raw = record(file.snapshot);
      const trip = record(raw?.plan);
      if (!snapshot || !departure || (transfer ? !trip : !plan)) throw Error('Invalid frozen receipt snapshot.');
      const routeFields = transfer ? [
        { label:'TRANSFER / MRF', value:`${textValue(raw?.transferRef)} / ${textValue(raw?.mrfRef)}` },
        ...(typeof raw?.warehouseRef === 'string' ? [{ label:'WAREHOUSE RECEIPT', value:raw.warehouseRef }] : []),
        { label:'PICKUP', value:`${textValue(trip?.pickupName)}\n${textValue(trip?.pickupAddress)}` },
        { label:'DESTINATION', value:`${textValue(trip?.destinationName)}\n${textValue(trip?.destinationAddress)}` },
      ] : [
        { label:'PICKUP', value:plan?.pickup },
        { label:'DESTINATION', value:`${plan?.destination}\n${plan?.address}` },
      ];
      const phTime = (value: string) => new Date(value).toLocaleString('en-PH', { timeZone:'Asia/Manila' });
      const bytes = await renderReceiptPdf({
        title:transfer ? 'STOCK TRANSFER RECEIPT' : 'DELIVERY RECEIPT', ref:snapshot.ref, stage:`Receipt version ${snapshot.revision}`, received:true,
        generatedAt:textValue(file.created_at),
        fields:[
          ...routeFields,
          { label:'DEPARTURE (PH TIME)', value:phTime(departure.at) },
          { label:'ACTUAL ARRIVAL (PH TIME)', value:phTime(snapshot.arrivalAt) },
          { label:'RECEIVER', value:textValue(file.receiverName) },
        ],
        materials:snapshot.lines.map(line => ({ name:line.description, unit:line.unit, expected:line.expected,
          accepted:line.accepted,
          issue:`Missing ${line.missing}; rejected ${line.rejected}. Accepted in request units: ${line.stockQuantity} ${line.stockUnit}. ${line.issue}` })),
        footerFields:snapshot.extraGoods ? [{ label:'EXTRA GOODS', value:snapshot.extraGoods }] : [],
        signatureLabels:['Dispatched by','Received by'],
      });
      size = bytes.length;
      sha256 = createHash('sha256').update(bytes).digest('hex');
      if (!providerId) {
        const checkpoint = rowValue(await rpc('workerId', { id, lease, patch:{ driveId:await drive.generateId() } }));
        providerId = textValue(checkpoint.drive_id);
      }
      if (!await drive.find(providerId)) {
        const uri = await drive.begin(providerId, folder, textValue(file.name), size, identity);
        if (!uri) throw Error('Drive did not confirm a receipt upload session.');
        let progress = await drive.transfer(uri, size);
        while (!progress.complete) {
          const offset = progress.offset;
          if (progress.expired || offset >= size) throw Error('Generated receipt upload expired.');
          progress = await drive.transfer(uri, size, bytes.subarray(offset, offset + QUOTE_CHUNK_SIZE), offset);
          if (!progress.complete && progress.offset <= offset) throw Error('Drive did not acknowledge receipt bytes.');
        }
      }
    }
    const bytes = await drive.verifyFile(providerId, folder, identity, size, sha256, mime);
    await validateQuotationOriginal(bytes, mime);
    await rpc('workerComplete', { id, lease, patch:{ size, sha256 } });
  } catch {
    await rpc('workerFail', { id, lease }).catch(() => {});
  }
}

export async function readReceiptFile(request: Request, id: string, transfer = false) {
  const rpc = bindReceiptRpc(transfer);
  privateDocumentRead(request);
  const actor = await documentActor();
  const file = rowValue(await rpc('read', { actor, id }));
  const mime = textValue(file.mime), size = Number(file.size);
  if (!QUOTE_MIMES.some(value => value === mime) || !Number.isSafeInteger(size) || size < 5) throw Error('Invalid archive metadata.');
  let range;
  try {
    range = documentRange(request.headers.get('range'), size);
  } catch {
    return new Response(null, { status:416, headers:{ 'Content-Range':`bytes */${size}`, 'Cache-Control':'private, no-store' } });
  }
  const upstream = await documentDrive().stream(textValue(file.driveId), range ?? undefined, request.signal);
  const headers = new Headers({
    'Content-Type':mime, 'Cache-Control':'private, no-store', 'X-Content-Type-Options':'nosniff',
    'Referrer-Policy':'no-referrer', 'Accept-Ranges':'bytes', Vary:'Cookie, Origin',
    'Content-Length':String(range ? range.end - range.start + 1 : size),
    'Content-Disposition':`inline; filename="receipt"; filename*=UTF-8''${encodeURIComponent(textValue(file.name))}`,
  });
  if (range) headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
  return new Response(upstream.body, { status:range ? 206 : 200, headers });
}
