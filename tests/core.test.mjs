import test from 'node:test';
import assert from 'node:assert/strict';
import { defineForgeConfig, resolveForgeConfig, logicalTestIdentity, executionIdentity, attemptIdentity, redactValue, planChangedArea, evaluateGates, RESULT_SCHEMA_VERSION } from '@azerish25-ux/forgeqa-core';

test('configuration precedence, arrays, paths and redaction are deterministic', () => {
  const input=defineForgeConfig({project:'demo',environments:{local:{baseUrl:'http://127.0.0.1:3000',variables:{TOKEN:'secret'}}},browsers:['chromium'],workers:2,timeout:'10s'});
  const first=resolveForgeConfig(input,{cwd:process.cwd(),env:{FORGEQA_WORKERS:'3'},cli:{workers:4,browsers:['firefox']}});
  const second=resolveForgeConfig(input,{cwd:process.cwd(),env:{FORGEQA_WORKERS:'3'},cli:{workers:4,browsers:['firefox']}});
  assert.equal(first.workers,4);assert.deepEqual(first.browsers,['firefox']);assert.equal(first.timeoutMs,10_000);assert.equal(first.configHash,second.configHash);assert.equal(first.redacted.environments.local.variables,undefined);
});

test('identities distinguish logical, execution and attempt dimensions',()=>{const logical=logicalTestIdentity({relativePath:'tests/payments.spec.ts',titlePath:['payments','refund']});const execution=executionIdentity({consumer:'demo',environment:'local',project:'chromium',repetition:0,logicalTestId:logical});assert.notEqual(execution,attemptIdentity(execution,0));assert.notEqual(attemptIdentity(execution,0),attemptIdentity(execution,1));});

test('redaction covers structured secrets and URLs',()=>{const value=redactValue({authorization:'Bearer abc',url:'https://u:p@example.test/x?token=abc&ok=1',nested:'password=hunter2'});assert.equal(value.authorization,'[REDACTED]');assert.match(value.url,/REDACTED/);assert.doesNotMatch(JSON.stringify(value),/hunter2|abc/);});

test('changed-area selection broadens unknown paths and includes new tests',()=>{const plan=planChangedArea({changedFiles:['apps/payments/a.ts'],allTests:['smoke','payments','new'],smokeTests:['smoke'],newTests:['new'],mapping:{'apps/payments/*':['payments']},baselineAvailable:true});assert.deepEqual(plan.selected,['new','payments','smoke']);const full=planChangedArea({changedFiles:['unknown/a.ts'],allTests:['a','b'],smokeTests:[],mapping:{},baselineAvailable:true});assert.equal(full.mode,'full');});

test('strict gate fails retry recovery and quarantined failure',()=>{const base={schemaVersion:RESULT_SCHEMA_VERSION,runId:'r',selectionHash:'s',configHash:'c',revision:{repository:'x',sourceCommit:'a',testedCommit:'a'},missingExecutions:[],unexpectedExecutions:[],duplicateExecutions:[],shardIds:['s'],completion:'complete'};const attempts=[{schemaVersion:RESULT_SCHEMA_VERSION,attemptId:'a0',executionId:'e',logicalTestId:'t',retry:0,outcome:'failed',startedAt:'2026-01-01T00:00:00Z',durationMs:1},{schemaVersion:RESULT_SCHEMA_VERSION,attemptId:'a1',executionId:'e',logicalTestId:'t',retry:1,outcome:'passed',startedAt:'2026-01-01T00:00:01Z',durationMs:1}];const decision=evaluateGates({...base,attempts},[],{failOnRetryRecovered:true,unexpectedSkipBudget:0,requireCompleteShards:true,maxQuarantineEntries:20});assert.equal(decision.outcome,'fail');assert.ok(decision.violations.some((v)=>v.id==='test.retry-recovered'));});
