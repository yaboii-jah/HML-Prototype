import 'server-only';
import { readSession } from '@/src/server/auth/session';
import { serviceRpc, ServiceCommandError } from '@/src/server/auth/service-rpc';
import { parseDeliveriesView, parseDeliveryCommand } from '@/src/domain/deliveries/contracts';
import { record } from '@/src/domain/projects/projects';
import { receiptFileCommand } from './receipt-files';

async function deliveryActor() {
  const s = await readSession();
  return s?.activeRole ? { userId:s.context.userId, sessionId:s.sessionId, revision:s.context.revision, activeRole:s.activeRole } : null;
}
export async function deliveriesView() {
  const actor = await deliveryActor();
  if (!actor) return null;
  const view = parseDeliveriesView(await serviceRpc('deliveries_read', { actor }));
  if (!view) throw Error('Delivery data could not be loaded.');
  return view;
}
export async function runDeliveryCommand(input: unknown) {
  const command = parseDeliveryCommand(input);
  if (!command) return { ok:false, message:'Review quantities, dates, locations and required reasons.' };
  try {
    const actor = await deliveryActor();
    if (!actor) return { ok:false, message:'Sign in again to record this delivery action.' };
    const result = record(await serviceRpc('delivery_command', { actor, command }));
    if (result?.targetId !== command.deliveryId) throw Error('Invalid delivery result');
    if (typeof result.receiptVersionId === 'string' && process.env.GOOGLE_DRIVE_ENABLED === 'true') {
      await receiptFileCommand({ type:'retry', kind:'generated', versionId:result.receiptVersionId }, actor).catch(() => {});
    }
    return { ok:true, message:'Delivery action recorded.', targetId:command.deliveryId };
  } catch (error) {
    if (error instanceof ServiceCommandError) {
      const messages: Record<string,string> = {
        '40001':'Delivery capacity or history changed. Your entries are preserved; review the current record before submitting again.',
        '42501':'Your access changed or this delivery is unavailable. Refresh and sign in again if needed.',
        '23514':'Review exact positive quantities, current/future planned dates, locations and reasons.',
        '23505':'This delivery already exists. Review the saved record.',
        P4803:'This retry identity was used for different input. Review current data before starting another action.',
        P4111:'Scheduling requires a PO recorded as issued to its supplier.',
        P4116:'Dispatch requires current Accounting clearance. Resolve the hold or source prerequisites first.',
        P4121:'The selected quantities exceed remaining PO capacity. Review other scheduled deliveries.',
        P4122:'This action is unavailable in the current delivery state.',
        P4123:'Departure must follow scheduling, issuance and the current clearance, and cannot be in the future. Escalate invalid departures externally.',
        P4130:'Review the arrival time and exact counts. All dispatched quantities must be accounted for and discrepancies explained.',
        P4131:'This action is unavailable for the current receipt. Refresh to review posting, forwarding or receipt status.',
        P4132:'Wait for the current generated receipt and signed evidence to finish archiving before approval.',
        '22007':'Enter a valid date and Philippine departure time.', '22008':'Enter a valid date and Philippine departure time.',
      };
      if (messages[error.code]) return { ok:false, conflict:error.code === '40001', message:messages[error.code] };
    }
    return { ok:false, uncertain:true, message:'The response was interrupted. Use Check saved outcome before another action.' };
  }
}
