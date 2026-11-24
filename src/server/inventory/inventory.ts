import 'server-only';
import { readSession } from '@/src/server/auth/session';
import { serviceRpc, ServiceCommandError } from '@/src/server/auth/service-rpc';
import { object } from '@/src/domain/accounts/accounts';
import { id } from '@/src/domain/purchasing/contracts';
import { parseInventoryCommand, parseInventoryView, parseStockReportCommand, type InventoryQuery, type InventoryCommand, type StockReportCommand } from '@/src/domain/inventory/contracts';

async function inventoryActor() {
  const session=await readSession();
  return session?.activeRole ? { userId:session.context.userId,sessionId:session.sessionId,
    revision:session.context.revision,activeRole:session.activeRole } : null;
}

export async function inventoryView({ mode,projectId,target }:InventoryQuery) {
  const viewer=await inventoryActor();
  if (!viewer) return null;
  const raw=await serviceRpc('inventory_read',{ viewer,mode,selected_project:projectId??null,target:target??null });
  const view=parseInventoryView(raw);
  if (!view) throw Error('Inventory could not be loaded.');
  return view;
}

export type InventoryOutcome = { ok:true; id:string } | { ok:false; message:string; uncertain?:boolean };
export async function runInventoryCommand(input:unknown):Promise<InventoryOutcome> {
  const command=parseInventoryCommand(input);
  if (!command) return { ok:false,message:'Check the quantities, material selection and explanations.' };
  return runStockCommand('inventory_command',command);
}

export async function runStockReportCommand(input:unknown):Promise<InventoryOutcome> {
  const command=parseStockReportCommand(input);
  if (!command) return { ok:false,message:'Check the project, material count and reason.' };
  return runStockCommand('stock_report_command',command);
}

async function runStockCommand(rpc:'inventory_command'|'stock_report_command',command:InventoryCommand|StockReportCommand):Promise<InventoryOutcome> {
  try {
    const viewer=await inventoryActor();
    if (!viewer) return { ok:false,uncertain:true,message:'Sign in again before checking the saved outcome.' };
    const result=object(await serviceRpc(rpc,{ viewer,command }));
    if (!id(result?.id)) throw Error('Invalid stock outcome.');
    return { ok:true,id:result.id };
  } catch (error) {
    const messages:Record<string,string> = {
      '40001':'Stock changed. Review current balances before submitting again.',
      '42501':'Your current role or project assignment does not allow this action.',
      P4170:'Check the quantities, material selection and explanations.',
      P4171:'Select a current material or movement for this project.',
      P4172:'The deduction exceeds available stock. Review the quantity and ask Procurement to release any transfer reservations that are no longer needed.',
      P4173:'This submission ID already belongs to another stock entry. Review the saved outcome before starting a new entry.',
      P4174:'This material and unit already have an inventory record. Open it to review the balance or record a correction.',
      P4175:'This stock report already has a decision. Review the latest outcome.',
      '23505':rpc==='stock_report_command'
        ? 'A matching report is already pending or this decision was already recorded. Review the stock reports.'
        : 'The stock record already exists. Review inventory before retrying.',
    };
    if (error instanceof ServiceCommandError && messages[error.code]) {
      return { ok:false,message:messages[error.code],uncertain:error.code==='42501' };
    }
    return { ok:false,uncertain:true,message:'The response was interrupted. Select Check saved outcome before submitting another entry.' };
  }
}
