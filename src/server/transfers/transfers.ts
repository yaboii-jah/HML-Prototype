import 'server-only';
import { readSession } from '@/src/server/auth/session';
import { serviceRpc, ServiceCommandError } from '@/src/server/auth/service-rpc';
import { object } from '@/src/domain/accounts/accounts';
import { id } from '@/src/domain/purchasing/contracts';
import { parseTransferCommand, parseTransferView } from '@/src/domain/transfers/contracts';

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
  const command=parseTransferCommand(input);
  if (!command) return { ok:false,message:'Review the selected materials, exact quantities and required explanations.' };
  try {
    const actor=await transferActor();
    if (!actor) return { ok:false,message:'Sign in again to record this action.' };
    const result=object(await serviceRpc('transfer_command',{ actor,command }));
    if (!Array.isArray(result?.ids)||!result.ids.every(id)) throw Error('Invalid transfer outcome.');
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
        P4803:'This operation identity already belongs to a different action.',
      };
      if (messages[error.code]) return { ok:false,conflict:['40001','P4142'].includes(error.code),message:messages[error.code] };
    }
    return { ok:false,uncertain:true,message:'The response was interrupted. Use Check saved outcome before another action.' };
  }
}
