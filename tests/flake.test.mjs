import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateReliability, fingerprintFailure, validateQuarantine } from '@azerish25-ux/forgeqa-flake-analysis';
import { RESULT_SCHEMA_VERSION } from '@azerish25-ux/forgeqa-core';
const attempt=(id,e,retry,outcome)=>({schemaVersion:RESULT_SCHEMA_VERSION,attemptId:id,executionId:e,logicalTestId:e,retry,outcome,startedAt:'2026-01-01T00:00:00Z',durationMs:1});

test('retries do not inflate logical execution denominator',()=>{const metrics=calculateReliability([attempt('a','e1',0,'failed'),attempt('b','e1',1,'passed'),attempt('c','e2',0,'passed')],20);assert.deepEqual({N:metrics.N,F:metrics.F,I:metrics.I,P:metrics.P},{N:2,F:1,I:1,P:0});assert.equal(metrics.sufficientSamples,false);});

test('zero history remains null rather than invented zero',()=>{const metrics=calculateReliability([],20);assert.equal(metrics.retryObservedFlakeRate,null);assert.equal(metrics.firstAttemptFailureRate,null);});

test('fingerprints normalize volatile values but retain meaningful expected values',()=>{const a=fingerprintFailure({name:'AssertionError',message:'expected 5 got 7 at 2026-01-01T00:00:00Z'});const b=fingerprintFailure({name:'AssertionError',message:'expected 5 got 7 at 2026-01-02T00:00:00Z'});const c=fingerprintFailure({name:'AssertionError',message:'expected 6 got 7 at 2026-01-02T00:00:00Z'});assert.equal(a,b);assert.notEqual(b,c);});

test('quarantine requires owner, bounded expiry and known test',()=>{const now=new Date('2026-01-01T00:00:00Z');const bad=[{schemaVersion:RESULT_SCHEMA_VERSION,testId:'missing',owner:'',reason:'x',issue:'x',createdAt:'2026-01-01T00:00:00Z',expiresAt:'2026-02-01T00:00:00Z'}];const result=validateQuarantine(bad,['known'],now);assert.equal(result.valid,false);assert.ok(result.errors.length>=3);});
