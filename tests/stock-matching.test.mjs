import test from 'node:test';
import assert from 'node:assert/strict';
import { materialId } from '../src/domain/ids.ts';
import { equivalentStockUnit, matchingStockDescription, normalizedMaterialName, rankStockCandidates } from '../src/domain/stock-matching.ts';

test('transfer unit aliases are symmetric, one to one, and limited to the agreed labels', () => {
  for (const group of [
    ['pc','pcs','piece','pieces'], ['bag','bags'], ['sheet','sheets'], ['length','lengths'],
    ['roll','rolls'], ['box','boxes'], ['pail','pails'], ['set','sets'], ['cartridge','cartridges'],
    ['cu.m','m3','m³','cubic meter','cubic meters','cubic metre','cubic metres'],
  ]) for (const a of group) for (const b of group) assert.equal(equivalentStockUnit(a,` ${b.toUpperCase()} `),true,`${a}/${b}`);
  for (const [a,b] of [['box','piece'],['length','meter'],['length','piece'],['bag','kg'],['kg','kilogram'],['gallon','liter']]) assert.equal(equivalentStockUnit(a,b),false);
  assert.equal(equivalentStockUnit(' Unknown unit ','UNKNOWN UNIT'),true);
  assert.notEqual(materialId('Cement','bag'),materialId('Cement','bags'),'Aliases must not change inventory identity');
});

test('source and destination searches rank exact, reordered and misspelled names without asserting specification equivalence', () => {
  const row = (name,unit='bags') => ({id:materialId(name,unit),name,unit});
  const item = {name:'Portland cement',unit:'bag'};
  const candidates = rankStockCandidates(item,[row('Safety net'),row('Cement Portland'),row('Portland cment'),row(' PORTLAND  CEMENT '),row('Portland cement','box')]);
  assert.equal(candidates[0].exact,true);
  assert.equal(candidates.find(value => value.name==='Cement Portland').suggested,true);
  assert.equal(candidates.find(value => value.name==='Portland cment').suggested,true);
  assert.equal(candidates.some(value => value.unit==='box'),false);
  assert.equal(rankStockCandidates(item,candidates,'safety')[0].name,'Safety net','Manual search includes lower-ranked stock');
  assert.equal(matchingStockDescription({name:'Rebar 12mm',unit:'pc'},'Rebar 16mm','pieces'),false);
  assert.notEqual(normalizedMaterialName('Rebar 12mm'),normalizedMaterialName('Rebar 16mm'));
});
