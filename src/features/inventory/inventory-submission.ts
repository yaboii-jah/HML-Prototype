'use client';

import { useEffect, useRef, useState } from 'react';
import { inventoryCommandAction } from '@/app/(workspace)/inventory/actions';
import { parseInventoryCommand, type InventoryCommand } from '@/src/domain/inventory/contracts';
import type { InventoryOutcome } from '@/src/server/inventory/inventory';

export function inventoryStorageKey(actorId:string, target:string) {
  return ['constructsync-inventory-v1',process.env.NEXT_PUBLIC_SUPABASE_URL??'workspace',actorId,target]
    .map(encodeURIComponent).join('/');
}

export function useInventorySubmission(key:string, accept:(command:InventoryCommand)=>boolean, onSaved:(id:string)=>void, refresh:()=>void) {
  return useSavedInventorySubmission(key,accept,onSaved,refresh,parseInventoryCommand,inventoryCommandAction,
    'Stock entry recorded.');
}

export function useSavedInventorySubmission<Command extends {operationId:string}>(key:string, accept:(command:Command)=>boolean,
  onSaved:(id:string)=>void, refresh:()=>void, parse:(input:unknown)=>Command|null,
  send:(command:Command)=>Promise<InventoryOutcome>, savedMessage:string|((command:Command)=>string)) {
  const [ready,setReady]=useState(false);
  const [pending,setPending]=useState<Command|null>(null);
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const running=useRef(false);
  const readAccepted=useRef(accept);

  useEffect(()=>{
    const timer=setTimeout(()=>{
      try {
        const raw=localStorage.getItem(key);
        if (raw) {
          const saved=parse(JSON.parse(raw));
          if (saved&&readAccepted.current(saved)) setPending(saved);
        }
      } catch { setMessage('The saved submission could not be opened.'); }
      setReady(true);
    },0);
    return ()=>clearTimeout(timer);
  },[key,parse]);

  async function submit(proposal?:Command) {
    if (!ready||running.current||proposal&&pending) return;
    let command=pending??proposal;
    try {
      const saved=parse(JSON.parse(localStorage.getItem(key)??'null'));
      if (saved&&!accept(saved)) return;
      if (saved&&saved.operationId!==command?.operationId) {
        setPending(saved);
        setMessage('A previous submission is still awaiting confirmation. Select Check saved outcome.');
        return;
      }
      command=saved??command;
      if (command) localStorage.setItem(key,JSON.stringify(command));
    } catch {
      setMessage('Browser storage is unavailable. Keep this page open until the outcome is known.');
    }
    if (!command||!accept(command)) return;
    setPending(command);
    running.current=true;
    setBusy(true);
    try {
      const result=await send(command);
      if (result.ok||!result.uncertain) {
        setPending(null);
        try {
          if (parse(JSON.parse(localStorage.getItem(key)??'null'))?.operationId===command.operationId) {
            localStorage.removeItem(key);
          }
        } catch { /* The saved identity remains safe to replay if storage recovers. */ }
      }
      if (result.ok) {
        setMessage(typeof savedMessage==='function'?savedMessage(command):savedMessage);
        onSaved(result.id);
      } else setMessage(result.message);
    } catch {
      setMessage('The response was interrupted. Select Check saved outcome.');
    } finally {
      running.current=false;
      setBusy(false);
      refresh();
    }
  }
  return { ready,pending,message,busy,submit };
}
