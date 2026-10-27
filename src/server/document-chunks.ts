import { documentUploadStatus, sendDocumentChunk } from "@/src/server/drive";
import { driveAccessError, driveError } from "./local-drive.ts";

type Ticket = { sessionUri: string; total: number };

export function createDocumentChunkHandlers<T extends Ticket>(options: {
  openTicket: (encoded: string) => T;
  mime: (ticket: T) => string;
  signature: (bytes: Uint8Array, ticket: T) => boolean;
  invalidMessage: string;
}) {
  const failure = (cause: unknown) => Response.json({ error: driveError(cause) }, { status: 502 });
  return {
    async POST(request: Request) {
      const denied = driveAccessError(request, true);
      if (denied) return denied;
      try {
        const ticket = options.openTicket(request.headers.get("x-drive-upload-ticket") || "");
        return Response.json(await documentUploadStatus(ticket.sessionUri, ticket.total));
      } catch (cause) { return failure(cause); }
    },
    async PUT(request: Request) {
      const denied = driveAccessError(request, true);
      if (denied) return denied;
      try {
        const ticket = options.openTicket(request.headers.get("x-drive-upload-ticket") || "");
        const header = request.headers.get("x-drive-upload-offset"), offset = Number(header);
        const length = request.headers.get("content-length");
        const invalid = () => Response.json({ error: options.invalidMessage }, { status: 400 });
        if (!header || !Number.isInteger(offset) || offset < 0 || offset >= ticket.total || offset % (256 * 1024) !== 0 || length && (!Number.isInteger(Number(length)) || Number(length) < 1 || Number(length) > 3 * 1024 * 1024)) return invalid();
        const bytes = new Uint8Array(await request.arrayBuffer());
        if (!bytes.length || bytes.length > 3 * 1024 * 1024 || offset + bytes.length > ticket.total || length && Number(length) !== bytes.length || offset + bytes.length < ticket.total && bytes.length % (256 * 1024) !== 0 || offset === 0 && !options.signature(bytes, ticket)) return invalid();
        return Response.json(await sendDocumentChunk(ticket.sessionUri, offset, ticket.total, bytes, options.mime(ticket)));
      } catch (cause) { return failure(cause); }
    },
  };
}
