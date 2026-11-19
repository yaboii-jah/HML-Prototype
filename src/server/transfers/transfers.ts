import 'server-only';
import { readSession } from '@/src/server/auth/session';
import { serviceRpc, ServiceCommandError } from '@/src/server/auth/service-rpc';
import { object } from '@/src/domain/accounts/accounts';
import { id } from '@/src/domain/purchasing/contracts';
import { parseTransferCommand, parseTransferView } from '@/src/domain/transfers/contracts';
import { parseTransferTripCommand } from '@/src/domain/transfers/trips';
import { parseTransferReceiptCommand } from '@/src/domain/transfers/receipts';
import { enqueueReceiptFile } from '@/src/server/deliveries/receipt-files';

async function transferActor() {
  const s=await readSession();
  return s?.activeRole ? { userId:s.context.userId, activeRole:s.activeRole, sessionId:s.sessionId, revision:s.context.revision } : null;
}

export async function transferView(targetRequest?:string, targetTransfer?:string) {
  const actor=await transferActor();
  if (!actor) return null;
  const result=await serviceRpc('transfer_read',{ actor,target_request:targetRequest??null,target_transfer:targetTransfer??null });
  if (result===null) return null;
  const view=parseTransferView(result);
  if (!view) throw Error('Transfer data could not be loaded.');
  return view;
}

export async function runTransferCommand(input:unknown) {
  const trip=parseTransferTripCommand(input);
  const receipt=parseTransferReceiptCommand(input);
  const command=trip??receipt??parseTransferCommand(input);
  if (!command) return { ok:false,message:'Review the selected materials, exact quantities and required explanations.' };
  try {
    const actor=await transferActor();
    if (!actor) return { ok:false,message:'Sign in again to record this action.' };
    const result=object(await serviceRpc(trip?'transfer_trip_command':receipt?'transfer_receipt_command':'transfer_command',{ actor,command }));
    if (!Array.isArray(result?.ids)||!result.ids.every(id)) throw Error('Invalid transfer outcome.');
    if (id(result.archiveFileId)) await enqueueReceiptFile(result.archiveFileId,true).catch(()=>{});
    return { ok:true,message:'Transfer action recorded.',ids:result.ids };
  } catch (error) {
    if (error instanceof ServiceCommandError) {
      const messages:Record<string,string> = {
        '40001':'The transfer or demand changed. Review the current quantities before retrying.',
        '42501':'This action requires a current role and project assignment.',
        '23514':'Check that the selections fit the remaining demand and available stock.',
        P4140:'Review the exact quantities, matching units and required explanations.',
        P4141:'This action is unavailable. Check the current status and approved material request archive.',
        P4142:'Available source stock changed. Review the quantities and try again.',
        P4143:'A different assigned source reviewer must approve this release.',
        P4144:'Set a document code on the destination project before requesting release.',
        P4150:'Review the route, exact load quantities, Philippine schedule and required reason.',
        P4151:'This trip action is unavailable. Review the current allocation and trip status.',
        P4152:'The load exceeds remaining booking capacity or the source reservation changed.',
        P4153:'Departure is paused until the current approved MRF archive is ready.',
        P4154:'Set the missing project location or destination document code before scheduling.',
        P4160:'Check the Philippine arrival time and exact counts. Explain every discrepancy.',
        P4161:'This action is unavailable for the saved transfer receipt or warehouse custody.',
        P4162:'Verify all current receipt and evidence archives before approval.',
        P4163:'The approved MRF archive must be ready before reclaiming demand.',
        P4164:'The shortage may already be sourced. Review demand and the current receipt before recounting.',
        P4123:'Choose an actual departure after booking, approval and archive readiness, within the allowed time window.',
        '22007':'Enter a valid Philippine date and time.',
        '22008':'Enter a valid Philippine date and time.',
        P4803:'This operation identity already belongs to a different action.',
      };
      if (messages[error.code]) return { ok:false,conflict:['40001','P4142','P4164'].includes(error.code),message:messages[error.code] };
    }
    return { ok:false,uncertain:true,message:'The response was interrupted. Use Check saved outcome before another action.' };
  }
}
