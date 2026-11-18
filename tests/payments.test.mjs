import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { grossSpent, parsePaymentBody, parsePaymentCommand, parsePlan, emptyPaymentBody, emptyPlan } from '../src/domain/payments/payments.ts';

test('gross spending uses cumulative half-up cents and never frees the gross obligation',()=>{
  assert.equal(grossSpent('10000.00','9900.00','4950.00'),'5000.00');
  assert.equal(grossSpent('10000.00','9900.00','9900.00'),'10000.00');
  assert.equal(grossSpent('1.01','1.00','0.50'),'0.51');
  assert.equal(grossSpent('10000.00','0.00','0.00'),'0.00');
  assert.equal(grossSpent('10000.00','0.00','0.00',true),'10000.00');
  assert.equal(grossSpent('9999999999999999.99','9999999999999999.99','9999999999999999.99'),'9999999999999999.99');
  assert.throws(()=>grossSpent('100.00','99.00','100.00'));
});
test('payment drafts preserve blanks and reject invalid money and calendar dates',()=>{
  assert.deepEqual(parsePaymentBody(emptyPaymentBody()),emptyPaymentBody());
  assert.equal(parsePaymentBody({...emptyPaymentBody(),amount:'0.00'}),null);
  assert.equal(parsePaymentBody({...emptyPaymentBody(),amount:'1.001'}),null);
  assert.equal(parsePaymentBody({...emptyPaymentBody(),date:'2026-02-30'}),null);
  assert.equal(parsePaymentBody({...emptyPaymentBody(),amount:'1.2'}).amount,'1.20');
});
test('coordination needs a scheduled date or delay reason without inventing payment',()=>{
  assert.deepEqual(parsePlan(emptyPlan()),emptyPlan());
  assert.equal(parsePlan({...emptyPlan(),status:'Scheduled'}),null);
  assert.equal(parsePlan({...emptyPlan(),status:'Delayed',note:'late'}),null);
});
test('settlement commands bind versions and explicit evidence review, excluding browser financial authority',()=>{
  const command={type:'verify',requestId:randomUUID(),poId:randomUUID(),draftId:randomUUID(),expectedVersion:'3',reason:'',evidenceReviewed:true};
  assert.deepEqual(parsePaymentCommand(command),command);
  assert.equal(parsePaymentCommand({...command,evidenceReviewed:false}),null);
  assert.equal(parsePaymentCommand({...command,expectedVersion:3}),null);
  assert.equal(parsePaymentCommand({...command,totals:{net:'5'}}),null);
  assert.equal(parsePaymentCommand({...command,type:'reverse',reason:''}),null);
});
