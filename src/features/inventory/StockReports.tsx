'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { stockReportAction } from '@/app/(workspace)/inventory/actions';
import { Badge, Field, InlineError } from '@/src/components/ui/Primitives';
import { RecordModal } from '@/src/components/ui/RecordModal';
import { Register } from '@/src/components/ui/Register';
import { parseStockReportCommand, type InventoryView } from '@/src/domain/inventory/contracts';
import { SubmissionStatus } from './InventoryActions';
import { inventoryStorageKey, useSavedInventorySubmission } from './inventory-submission';

const formatDate = (value:string) => new Date(value).toLocaleString('en-PH',{ timeZone:'Asia/Manila' });
const emptyCount = { description:'', unit:'', quantity:'', reason:'' };
const statusText = {pending:'Pending',approved:'Approved',rejected:'Rejected'};

export function StockReports({ view, actorId, initialProject, refresh }: {
  view:InventoryView; actorId:string; initialProject:string; refresh:()=>void;
}) {
  const site=view.role==='Site Personnel';
  const [project,setProject]=useState(initialProject || (view.projects.length===1 ? view.projects[0].id : ''));
  const [count,setCount]=useState(emptyCount);
  const [problem,setProblem]=useState('');
  const [reportId,setReportId]=useState<string|null>(null);
  const [rejection,setRejection]=useState('');
  const reports=view.stockReports??[];
  const report=reports.find(item=>item.id===reportId);
  const submission=useSavedInventorySubmission(inventoryStorageKey(actorId,site?'stock-report':'stock-report-review'),
    command=>view.projects.some(item=>item.id===command.projectId)
      && (site ? command.action==='submit' : view.role==='Accounting'&&command.action!=='submit'),
    ()=>{setCount(emptyCount);setReportId(null);setProblem('');},refresh,parseStockReportCommand,stockReportAction,
    command=>command.action==='submit' ? 'Stock report submitted.'
      : command.action==='approve' ? 'Report approved and opening stock posted.' : 'Stock report rejected.');
  const locked=!submission.ready||!!submission.pending||submission.busy;

  function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const command=parseStockReportCommand({ ...count,quantity:count.quantity.trim(),
      operationId:crypto.randomUUID(),projectId:project,action:'submit' });
    if (!command) {
      setProblem('Enter a project, material, unit, positive count and a reason of at least five characters.');
      return;
    }
    setProblem('');
    void submission.submit(command);
  }

  function review(action:'approve'|'reject') {
    if (!report||report.status!=='pending'||locked||(action==='approve'&&report.accountId)) return;
    const base={ operationId:crypto.randomUUID(),projectId:report.projectId,reportId:report.id };
    void submission.submit(action==='approve'?{ ...base,action }:{ ...base,action,reason:rejection.trim() });
  }

  return <>
    {site&&view.projects.length>0&&<section className="panel">
      <h2>Report unrecorded stock</h2>
      <p>Accounting reviews your count before it adds to available stock. If a delivery or transfer receipt is waiting to be posted, post that receipt.</p>
      <form className="stock-transfer-approval-form" onSubmit={submit}>
        <fieldset disabled={locked}>
          <div className="form-grid">
            <Field label="Project"><select required value={project} onChange={event=>setProject(event.target.value)}>
              <option value="">Choose an assigned project</option>
              {view.projects.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
            </select></Field>
            <Field label="Material description"><input required maxLength={4000} value={count.description}
              onChange={event=>setCount({...count,description:event.target.value})}/></Field>
            <Field label="Unit"><input required maxLength={4000} value={count.unit}
              onChange={event=>setCount({...count,unit:event.target.value})}/></Field>
            <Field label="Counted quantity"><input required inputMode="decimal" maxLength={80} value={count.quantity}
              onChange={event=>setCount({...count,quantity:event.target.value})}/></Field>
          </div>
          <Field label="Count reason"><textarea required minLength={5} maxLength={2000} value={count.reason}
            onChange={event=>setCount({...count,reason:event.target.value})}/></Field>
          <InlineError message={problem}/>
          <div className="form-actions"><button className="button primary">Submit stock report</button></div>
        </fieldset>
      </form>
    </section>}
    <section className="panel" aria-labelledby="stock-reports-heading">
      <h2 id="stock-reports-heading">Stock reports</h2>
      {!report&&<SubmissionStatus state={submission}/>}
      <Register embedded rows={reports} unit="stock reports" empty="No stock reports yet."
        headers={<><th>Material</th><th>Project</th><th>Count</th><th>Status</th><th>Action</th></>}
        renderRow={item=><tr key={item.id}>
          <th scope="row">{item.description}</th>
          <td>{view.projects.find(project=>project.id===item.projectId)?.name}</td>
          <td>{item.quantity} {item.unit}</td>
          <td><Badge value={item.status}>{statusText[item.status]}</Badge></td>
          <td><button type="button" className="button secondary"
            onClick={()=>{setReportId(item.id);setRejection('');}}>
            {!site&&item.status==='pending'?'Review report':'View report'}
          </button></td>
        </tr>}/>
    </section>
    <RecordModal open={!!report} title={report?.description??'Stock report'} onClose={()=>setReportId(null)}>
      {report&&<div className="form-stack">
        <dl className="data-rows">
          <div><dt>Project</dt><dd>{view.projects.find(item=>item.id===report.projectId)?.name}</dd></div>
          <div><dt>Counted quantity</dt><dd>{report.quantity} {report.unit}</dd></div>
          <div><dt>Count reason</dt><dd>{report.reason}</dd></div>
          <div><dt>Reported by</dt><dd>{report.reporterName} · {formatDate(report.reportedAt)}</dd></div>
          {report.reviewerName&&report.reviewedAt&&<div><dt>Reviewed by</dt>
            <dd>{report.reviewerName} · {formatDate(report.reviewedAt)}</dd></div>}
          {report.rejectionReason&&<div><dt>Rejection reason</dt><dd>{report.rejectionReason}</dd></div>}
        </dl>
        <p><Badge value={report.status}>{statusText[report.status]}</Badge></p>
        {report.accountId&&<p>
          <Link href={`/inventory/${report.projectId}/${report.accountId}`}>Open inventory record</Link>
          {report.status==='pending'&&' to review the existing balance. This report can be rejected with an explanation.'}
        </p>}
        {!site&&report.status==='pending'&&<>
          <Field label="Rejection reason"><textarea disabled={locked} maxLength={2000}
            value={rejection} onChange={event=>setRejection(event.target.value)}/></Field>
          <div className="form-actions">
            <button type="button" className="button secondary" disabled={locked||rejection.trim().length<5}
              onClick={()=>review('reject')}>Reject</button>
            <button type="button" className="button primary" disabled={locked||!!report.accountId}
              onClick={()=>review('approve')}>Approve and post stock</button>
          </div>
        </>}
        <SubmissionStatus state={submission}/>
      </div>}
    </RecordModal>
  </>;
}
