import { describe,it,expect } from 'vitest';
import { decodePopulationUtf8, includePopulation,parsePopulationCsv,populationUtcDate,reconcilePopulation } from './population.js';
import { bindingDigest,bindingDigestEnvelope } from '../sources/population-source.js';
import { sha256Hex,utf8Bytes } from '../sha256.js';
import { canonicalJson } from '../canonical-json.js';
const period={from:'2026-08-01',to:'2026-08-31'};
const fields={kind:'versioned-file' as const,location:'https://synthetic.invalid/population.csv',declaredSchema:['amount','currency','date'],sensitiveFields:[],declaredCountMechanism:'cover-sheet' as const};
const source={bindingId:'018f0000-0000-7000-8000-000000000099',displayName:'Population',digest:bindingDigest(fields),contract:bindingDigestEnvelope(fields)};
const rule={schemaVersion:1 as const,all:[{kind:'decimal' as const,column:'amount',operator:'gte' as const,value:'100000.00'},{kind:'text' as const,column:'currency',operator:'eq' as const,value:'USD'},{kind:'within-period' as const,column:'date'}]};
function reconcile(text:string,patch:Record<string,unknown>={},zeroRecordPass=false) {
 const declaration={schema_version:1,representation:'csv-raw-v1',source:'population',generation:'g1',generated_at:'2026-09-01T00:00:00.000Z',effective_period:{from:'2026-01-01',to:'2026-08-31'},schema:fields.declaredSchema,count:1,sha256:sha256Hex(text),complete:true,...patch};
 return reconcilePopulation({bytes:utf8Bytes(text),mediaType:'text/csv',declaration,source,period,rule,zeroRecordPass,initiatedAt:'2026-09-05T00:00:00.000Z'});
}
describe('deterministic population',()=>{
 it('preserves quoted raw strings, duplicate rows and source order',()=>{ expect(parsePopulationCsv('id,note\r\n001,"a,b\r\nc"\r\n001,"a,b\r\nc"\r\n')).toEqual([{id:'001',note:'a,b\r\nc'},{id:'001',note:'a,b\r\nc'}]); });
 it.each(['a,a\n1,2\n','a,b\n1\n','a\n"unterminated','a\n"closed"oops\n','a\nabc"x\n'])('rejects malformed CSV %s',text=>expect(()=>parsePopulationCsv(text)).toThrow());
 it('evaluates all predicates; invalid values dominate false predicates',()=>{
  const rows=includePopulation([{amount:'100000.00',currency:'USD',date:'2026-09-01T00:30:00+01:00'},{amount:'99999.99',currency:'USD',date:'2026-08-31'},{amount:'100000',currency:'EUR',date:'2026-08-31'},{amount:'bad',currency:'EUR',date:''}],rule,period);
  expect(rows.map(r=>r.disposition)).toEqual(['included','excluded','excluded','indeterminate']);expect(rows[3]!.reasons).toHaveLength(3);
 });
 it('keeps arbitrary precision and never converts currency',()=>expect(includePopulation([{amount:'999999999999999999999999.99',currency:'USD',date:'2026-08-01'}],rule,period)[0]!.disposition).toBe('included'));
 it.each(['2026-02-30','2026-08-01T24:00:00Z','2026-08-01T12:00:00+99:00','2026-08-01T12:00:00','2026-08-01junk'])('refuses malformed Gregorian time %s',s=>expect(populationUtcDate(s)).toBeNull());
 it('reconciles independent declarations before inclusion and allows covered subperiod',()=>expect(reconcile('amount,currency,date\n100000.00,USD,2026-08-01\n').ready).toBe(true));
 // Generation 32 (owner decision, 2026-09-06). The `declared-count` CHECK says only THAT
 // the two disagreed; these are the two numbers, so a reader can see by how much and in
 // which direction. `declaredCount` is never defaulted to what was retrieved — that would
 // make every unreconciled population look reconciled — and `retrievedCount` is exactly
 // the partition the three dispositions cover.
 it('reports the declared and the retrieved count as two separate facts',()=>{
  const agreed=reconcile('amount,currency,date\n100000.00,USD,2026-08-01\n');
  expect(agreed).toMatchObject({declaredCount:1,retrievedCount:1});
  const short=reconcile('amount,currency,date\n100000.00,USD,2026-08-01\n99999.99,USD,2026-08-02\n',{count:1,sha256:sha256Hex('amount,currency,date\n100000.00,USD,2026-08-01\n99999.99,USD,2026-08-02\n')});
  expect(short).toMatchObject({declaredCount:1,retrievedCount:2});
  expect(short.checks.find(c=>c.name==='declared-count')?.passed).toBe(false);
  expect(short.included+short.excluded+short.indeterminate).toBe(short.retrievedCount);
 });
 it.each([{count:undefined},{count:'3'},{count:-1},{count:1.5},{count:Number.MAX_SAFE_INTEGER+2}])('records no declared count for an unstorable %j',patch=>{
  const result=reconcile('amount,currency,date\n100000.00,USD,2026-08-01\n',patch);
  expect(result.declaredCount).toBeNull();
  expect(result.retrievedCount).toBe(1);
 });
 it('reports a retrieved count of zero when the bytes could not be parsed at all',()=>{
  // The rows are what the RAW artifact yielded, so an unparsable artifact retrieved
  // nothing. A count borrowed from the declaration here would report records nobody read.
  const result=reconcile('a\n"unterminated');
  expect(result.checks.find(c=>c.name==='parse')?.passed).toBe(false);
  expect(result.retrievedCount).toBe(0);
 });
 it.each([{count:2},{sha256:'0'.repeat(64)},{schema:['wrong']},{complete:false},{effective_period:{from:'2026-07-01',to:'2026-07-31'}},{generated_at:'2026-10-01T00:00:00.000Z'},{generated_at:'2026-09-01'}])('fails independent check %j',patch=>{ const result=reconcile('amount,currency,date\n100000.00,USD,2026-08-01\n',patch);expect(result.ready).toBe(false);expect(result.rows).toHaveLength(1); });
 it('opt-in never overrides malformed headers or other failed checks',()=>{expect(reconcile('amount,currency,date\n',{count:0},true).ready).toBe(true);expect(reconcile('wrong,header,names\n',{count:0},true).ready).toBe(false);expect(reconcile('amount,currency,date\n',{count:0},false).ready).toBe(false);});
 it('retains missing inclusion values as indeterminate',()=>{const result=reconcile('amount,currency,date\n,EUR,2026-08-01\n');expect(result.indeterminate).toBe(1);expect(result.excluded).toBe(0);
  // Not ready, but on `nonempty-population`: nothing was included at all.
  expect(result.checks.filter(c=>!c.passed).map(c=>c.name)).toEqual(['complete-inclusion','nonempty-population']);expect(result.ready).toBe(false);});
 it('lets an indeterminate row reach the Run-level Gate instead of ending the Run',()=>{
  // §H's early-stop row is "Population acquisition", which is about acquisition FAILING;
  // an unaccounted row is not that. §E decides the Gate rows "after the last Work Item",
  // so the Run executes and `count-reconciliation-inclusion` concludes it INCONCLUSIVE at
  // the end — by which time the period's other records have Observations, evaluations and
  // Exceptions. P-3's golden expectations name three causes of its Inconclusive outcome,
  // and only a Run that reaches all three can have them.
  const result=reconcile('amount,currency,date\n100000.00,USD,2026-08-01\n,EUR,2026-08-02\n',{count:2});
  expect([result.included,result.excluded,result.indeterminate]).toEqual([1,0,1]);
  expect(result.checks.filter(c=>!c.passed).map(c=>c.name)).toEqual(['complete-inclusion']);
  expect(result.ready).toBe(true);
 });
 it('still stops the Run for every check about the bytes themselves',()=>{
  // The one exception is `complete-inclusion` and nothing else: a Run that cannot trust
  // its bytes has nothing to execute over.
  const rows='amount,currency,date\n100000.00,USD,2026-08-01\n,EUR,2026-08-02\n';
  for (const patch of [{count:1},{sha256:'0'.repeat(64)},{schema:['wrong']},{complete:false},{representation:'wrong'},{source:''},{generation:''},{effective_period:{from:'2026-07-01',to:'2026-07-31'}},{generated_at:'2026-10-01T00:00:00.000Z'}]) {
   expect(reconcile(rows,{count:2,...patch}).ready,JSON.stringify(patch)).toBe(false);
  }
  expect(reconcile('not,a,population\n1,2,3\n',{count:2}).ready).toBe(false);
 });
 it('checks API raw bytes separately from versioned row digests and completeness',()=>{
  const rows=[{amount:'100000.00',currency:'USD',date:'2026-08-01'}];
  const declaration={schema_version:1,representation:'population-rows-v1',source:'transactions',generation:'g1',generated_at:'2026-09-01T00:00:00Z',effective_period:period,schema:fields.declaredSchema,count:1,sha256:sha256Hex(canonicalJson({schema_version:1,rows})),complete:true};
  const apiFields={...fields,kind:'read-only-api' as const,location:'https://synthetic.invalid/transactions',declaredCountMechanism:'count-endpoint' as const};
  const apiSource={...source,digest:bindingDigest(apiFields),contract:bindingDigestEnvelope(apiFields)};
  const payload={...declaration,transactions:rows};
  const run=(body:unknown)=>reconcilePopulation({bytes:utf8Bytes(JSON.stringify(body)),mediaType:'application/json',declaration,source:apiSource,period,rule,zeroRecordPass:false,initiatedAt:'2026-09-05T00:00:00Z'});
  const result=run(payload);expect(result.ready).toBe(true);expect(result.rawDigest).not.toBe(result.rowsDigest);
  expect(run({...payload,complete:false}).ready).toBe(false);expect(run({...payload,next_page:'https://elsewhere.invalid'}).ready).toBe(false);expect(run({...payload,employees:[]}).checks[0]?.passed).toBe(false);expect(run({...payload,transactions:[null]}).checks[0]?.passed).toBe(false);
  for (const patch of [{schema_version:2},{schema_version:undefined},{representation:'other'},{representation:undefined},{schema:['wrong']},{schema:undefined}]) {
   expect(run({...payload,...patch}).checks.find(c=>c.name==='response-contract')?.passed).toBe(false);
  }
  for (const patch of [{continuation_token:'more'},{cursor:'more'},{has_more:true},{pagination:{next:'more'}},{next:null}]) {
   expect(run({...payload,...patch}).checks.find(c=>c.name==='complete-extraction')?.passed).toBe(false);
  }
  for (const invalid of ['bad\0value','bad\ud800value']) {
   expect(run({...payload,transactions:[{...rows[0],amount:invalid}]}).checks[0]?.passed).toBe(false);
   expect(run({...payload,transactions:[{...rows[0],amount:invalid}]}).rawDigest).toHaveLength(64);
  }
 });
 it('rejects invalid UTF-8 and unsupported media while preserving the raw digest',()=>{
  const result=reconcilePopulation({bytes:new Uint8Array([0xff]),mediaType:'application/octet-stream',declaration:null,source,period,rule,zeroRecordPass:true,initiatedAt:'2026-09-05T00:00:00Z'});
  expect(result.ready).toBe(false);expect(result.rawDigest).toHaveLength(64);expect(result.checks[0]).toEqual({name:'parse',passed:false});
 });
 it('decodes across bounded UTF-8 chunks without replacing malformed bytes',()=>{
  const text='a'.repeat(8191)+'€😀'+'b'.repeat(8192)+'é';
  expect(decodePopulationUtf8(utf8Bytes(text))).toBe(text);
  expect(()=>decodePopulationUtf8(new Uint8Array([...new Uint8Array(8191).fill(65),0xc3]))).toThrow();
  expect(()=>decodePopulationUtf8(new Uint8Array([0xef,0xbb,0xbf,65]))).toThrow();
  expect(()=>decodePopulationUtf8(new Uint8Array([65,0,66]))).toThrow();
 });
 it('preserves escaped quotes, empty fields and a final field without a newline',()=>{
  expect(parsePopulationCsv('a,b,c\n"a""b",,""')).toEqual([{a:'a"b',b:'',c:''}]);
 });
});
