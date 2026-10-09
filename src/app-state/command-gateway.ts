import type { Command, CommandResult } from "../domain/commands.ts";
import type { AuditIdentity, DemoSnapshot, OperationTarget } from "../domain/types.ts";
import { copyIdentity, validIdentity } from "../domain/audit.ts";
import { operationAllows, operationFingerprint } from "../domain/operations.ts";

export type CommandRunner = (command: Command) => Promise<CommandResult>;
type Repository = { execute: (command: Command, actor?: AuditIdentity) => Promise<CommandResult>; getSnapshot: () => { snapshot: DemoSnapshot | null } };
const denied = (message: string): CommandResult => ({ ok: false, message });
export function bindAccountCommands(repository: Repository, expected: AuditIdentity | undefined, activeAccount: () => AuditIdentity | undefined) {
  const actor = copyIdentity(expected);
  const current = () => { const active = activeAccount(); return actor && validIdentity(actor) && active?.email === actor.email && active.role === actor.role && active.userId === actor.userId && active.sessionRevision === actor.sessionRevision; };
  const run: CommandRunner = async command => {
    if (command.type === "setRole" || command.type === "startOperation") return denied("Use the account or operation controls to continue.");
    if (!current()) return denied("Your account changed. Sign in and try this action again.");
    return repository.execute(command, copyIdentity(activeAccount()));
  };
  const beginOperation = async (target: OperationTarget): Promise<CommandRunner> => {
    if (!current()) throw new Error("Sign in with the initiating account before starting this operation.");
    const initiator = copyIdentity(activeAccount());
    const scope = structuredClone(target);
    const initial = repository.getSnapshot().snapshot;
    if (!initial) throw new Error("The workspace is unavailable.");
    const fingerprint = operationFingerprint(initial, scope);
    const priorIds = new Set(repository.getSnapshot().snapshot?.accounting.flatMap(record => record.documents?.map(document => document.id) || []));
    const start = await repository.execute({ type: "startOperation", target: scope }, initiator);
    if (!start.ok) throw new Error(start.message);
    let attached = false;
    const acknowledged = new Set<string>();
    const createdEvidence = new Map<string, string>();
    return async command => {
      const evidenceCommand = command.type === "completeAccountingArchive" || command.type === "failAccountingArchive";
      const evidenceStart = command.type === "startOperation" && command.target.kind === "evidence";
      const derivedEvidence = scope.kind === "attachment" && (evidenceCommand && command.poId === scope.poId && createdEvidence.has(command.documentId) || evidenceStart && command.target.kind === "evidence" && command.target.poId === scope.poId && createdEvidence.has(command.target.documentId));
      if (!derivedEvidence && !operationAllows(scope, command)) return denied("This operation cannot change another record or perform business decisions.");
      const snapshot = repository.getSnapshot().snapshot;
      if (!snapshot || operationFingerprint(snapshot, scope) !== fingerprint) return denied("The operation's source record changed. Start a new operation.");
      if (derivedEvidence && scope.kind === "attachment") {
        const documentId = evidenceCommand ? command.documentId : command.type === "startOperation" && command.target.kind === "evidence" ? command.target.documentId : "";
        if (createdEvidence.get(documentId) !== operationFingerprint(snapshot, {kind:"evidence",poId:scope.poId,documentId})) return denied("The evidence changed. Start a new archive operation.");
      }
      if (scope.kind === "attachment" && command.type === "attachAccountingDocuments" && attached) return denied("This attachment operation has already saved its documents.");
      const acknowledgement = command.type !== "startOperation" && command.type !== "attachAccountingDocuments" ? JSON.stringify(command) : undefined;
      if (acknowledgement && acknowledged.has(acknowledgement)) return { ok: true, snapshot, message: "This operation acknowledgement was already saved." };
      const result = await repository.execute(command, initiator);
      if (result.ok && acknowledgement) acknowledged.add(acknowledgement);
      if (result.ok && scope.kind === "attachment" && command.type === "attachAccountingDocuments") {
        attached = true;
        for (const document of result.snapshot.accounting.find(record => record.poId === scope.poId)?.documents || []) if (!priorIds.has(document.id) && document.batchId === scope.batchId && document.uploadedByIdentity?.email === initiator?.email) createdEvidence.set(document.id, operationFingerprint(result.snapshot, {kind:"evidence",poId:scope.poId,documentId:document.id}));
      }
      return result;
    };
  };
  return { run, beginOperation };
}
