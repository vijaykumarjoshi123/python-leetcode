/**
 * Vitest suite for backend/services/pipelineOrchestrator.js.
 *
 * Section 11Z — optional cleanup. The orchestrator has been growing
 * with each pipeline-simulator section (11D–11J); pinning its
 * behaviour with unit tests makes future changes safer.
 *
 * What's covered:
 *   - topoSort — Kahn's algorithm on the stages[] DAG
 *   - applyFailuresToStage — failure-type catalogue + oom/late-data/
 *     schema-drift/poison-message/slow-consumer dispatch
 *   - stageCodesEqual — Map/plain-object byte-equality
 *   - computePipelineScore — correctness, operational sub-scores,
 *     shotgun-debugging detection
 *   - getDiagnosticsMode / shouldPersistDiagnostics — the cost-limit
 *     policy that 11I added
 *
 * What is NOT covered here:
 *   - runPipeline (would need Mongo + docker-spawn mocking; out of
 *     scope for the unit-test MVP)
 *   - resolveFixtureMounts / resolveMutatedFixtureMounts (filesystem
 *     fixtures; covered by integration tests instead)
 *
 * Mongoose / PipelineRun is mocked at the require-cache level via the
 * `installPipelineRunMock` helper. This avoids needing a Mongo
 * connection in unit tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mock mongoose-dependent models before importing the orchestrator.
// We replace require('../models/PipelineRun') and require('../models/User')
// with stubs that return controlled responses.
const state = {
  pipelineRuns: [],
  user: null,
};

function installPipelineRunMock() {
  const Module = require('module');
  const origLoad = Module._load;
  Module._load = function (req, parent, ...rest) {
    if (req === '../models/PipelineRun' || req.endsWith('/models/PipelineRun')) {
      return {
        find: () => ({
          sort: () => ({
            limit: () => ({
              select: async () => state.pipelineRuns,
            }),
          }),
        }),
      };
    }
    if (req === '../models/User' || req.endsWith('/models/User')) {
      return {
        findById: async (id) => state.user,
      };
    }
    if (req === '../models/PipelineProblem' || req.endsWith('/models/PipelineProblem')) {
      // Minimal shape used by resolveScenarioFailures and validatePipelineShape.
      return {
        findById: async () => null,
        validatePipelineShape: () => null,
      };
    }
    return origLoad.call(this, req, parent, ...rest);
  };
}

installPipelineRunMock();

const orchestrator = require('./pipelineOrchestrator');

describe('topoSort', () => {
  it('returns stages in dependency order for a linear DAG', () => {
    const stages = [
      { id: 'c', executorType: 'python', dependsOn: ['b'] },
      { id: 'b', executorType: 'python', dependsOn: ['a'] },
      { id: 'a', executorType: 'python', dependsOn: [] },
    ];
    const order = orchestrator.topoSort(stages);
    expect(order.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('handles parallel roots merging into a downstream stage', () => {
    const stages = [
      { id: 'c', executorType: 'python', dependsOn: ['a', 'b'] },
      { id: 'a', executorType: 'python', dependsOn: [] },
      { id: 'b', executorType: 'python', dependsOn: [] },
    ];
    const order = orchestrator.topoSort(stages);
    const ids = order.map((s) => s.id);
    expect(ids.indexOf('a')).toBeLessThan(ids.indexOf('c'));
    expect(ids.indexOf('b')).toBeLessThan(ids.indexOf('c'));
    expect(order.length).toBe(3);
  });

  it('throws on cycles', () => {
    const stages = [
      { id: 'a', executorType: 'python', dependsOn: ['b'] },
      { id: 'b', executorType: 'python', dependsOn: ['a'] },
    ];
    expect(() => orchestrator.topoSort(stages)).toThrow(/cycle/i);
  });

  it('handles empty stages array', () => {
    expect(orchestrator.topoSort([])).toEqual([]);
  });
});

describe('applyFailuresToStage', () => {
  it('returns the stage defaults when no failures apply', () => {
    const stage = { id: 'enrich', executorType: 'pyspark' };
    const result = orchestrator.applyFailuresToStage(stage, [], {});
    expect(result.effectiveMemoryMb).toBeGreaterThan(0);
    expect(result.appliedFailures).toEqual([]);
  });

  it('oom_on_stage overrides memoryMb', () => {
    const stage = { id: 'enrich', executorType: 'pyspark' };
    const failures = [{ stageId: 'enrich', type: 'oom_on_stage', params: new Map([['memoryMb', 64]]) }];
    const result = orchestrator.applyFailuresToStage(stage, failures, {});
    expect(result.effectiveMemoryMb).toBe(64);
    expect(result.appliedFailures[0].applied).toBe(true);
  });

  it('late_data is recorded but flagged applied=false when fixture layer unavailable', () => {
    const stage = { id: 'ingest', executorType: 'kafka' };
    const failures = [{ stageId: 'ingest', type: 'late_data', params: new Map([['delayHours', 3]]) }];
    const result = orchestrator.applyFailuresToStage(stage, failures, { fixtureLayerAvailable: false });
    const f = result.appliedFailures[0];
    expect(f.applied).toBe(false);
    expect(f.note).toMatch(/fixture/i);
  });

  it('late_data is applied when fixture layer is available', () => {
    const stage = { id: 'ingest', executorType: 'kafka' };
    const failures = [{ stageId: 'ingest', type: 'late_data', params: new Map([['delayHours', 2]]) }];
    const result = orchestrator.applyFailuresToStage(stage, failures, { fixtureLayerAvailable: true });
    const f = result.appliedFailures[0];
    expect(f.applied).toBe(true);
    expect(f.note).toMatch(/delayed/i);
  });

  it('unknown failure types are recorded but not applied', () => {
    const stage = { id: 'enrich', executorType: 'pyspark' };
    const failures = [{ stageId: 'enrich', type: 'network_partition', params: new Map() }];
    const result = orchestrator.applyFailuresToStage(stage, failures, {});
    expect(result.appliedFailures[0].applied).toBe(false);
    expect(result.appliedFailures[0].note).toMatch(/unknown/i);
  });

  it('slow_consumer sets the PIPELINE_SLOW_CONSUMER_DELAY_MS env var', () => {
    const stage = { id: 'ingest', executorType: 'kafka' };
    const failures = [{ stageId: 'ingest', type: 'slow_consumer', params: new Map([['delayMs', 200]]) }];
    const result = orchestrator.applyFailuresToStage(stage, failures, {});
    expect(result.extraEnv.PIPELINE_SLOW_CONSUMER_DELAY_MS).toBe('200');
  });

  it('ignores failures targeting other stages', () => {
    const stage = { id: 'enrich', executorType: 'pyspark' };
    const failures = [{ stageId: 'ingest', type: 'oom_on_stage', params: new Map([['memoryMb', 64]]) }];
    const result = orchestrator.applyFailuresToStage(stage, failures, {});
    expect(result.appliedFailures).toEqual([]);
  });
});

describe('stageCodesEqual', () => {
  it('returns true for two equal Maps', () => {
    expect(orchestrator.stageCodesEqual(
      new Map([['a', '1'], ['b', '2']]),
      new Map([['a', '1'], ['b', '2']]),
    )).toBe(true);
  });

  it('returns false when values differ', () => {
    expect(orchestrator.stageCodesEqual(
      new Map([['a', '1']]),
      new Map([['a', '2']]),
    )).toBe(false);
  });

  it('returns true across Map + plain-object shapes', () => {
    expect(orchestrator.stageCodesEqual(
      new Map([['a', '1']]),
      { a: '1' },
    )).toBe(true);
  });

  it('returns false when key sets differ', () => {
    expect(orchestrator.stageCodesEqual({ a: '1' }, { b: '1' })).toBe(false);
  });

  it('returns true for two empty inputs', () => {
    expect(orchestrator.stageCodesEqual({}, {})).toBe(true);
    expect(orchestrator.stageCodesEqual(null, null)).toBe(true);
  });
});

describe('computePipelineScore', () => {
  beforeEach(() => {
    state.pipelineRuns = [];
  });

  it('returns total=1.00 on a first-attempt perfect run', async () => {
    const score = await orchestrator.computePipelineScore({
      userId: 'u1',
      pipelineProblemId: 'p1',
      scenarioId: null,
      stageResults: [
        { status: 'passed' },
        { status: 'passed' },
        { status: 'passed' },
        { status: 'passed' },
      ],
      codeMap: { ingest: 'a', enrich: 'b' },
      thisRuntimeMs: 30000,
    });
    expect(score.total).toBe(1);
    expect(score.correctness).toBe(1);
    expect(score.operational).toBe(1);
    expect(score.breakdown.attemptNumber).toBe(1);
  });

  it('counts skipped stages as full correctness credit', async () => {
    const score = await orchestrator.computePipelineScore({
      userId: 'u1',
      pipelineProblemId: 'p1',
      scenarioId: null,
      stageResults: [
        { status: 'passed' },
        { status: 'failed' },
        { status: 'skipped' },
        { status: 'skipped' },
      ],
      codeMap: { ingest: 'a' },
      thisRuntimeMs: 30000,
    });
    // 1 passed + 2 skipped out of 4 = 0.75
    expect(score.correctness).toBe(0.75);
    expect(score.breakdown.stagesPassed).toBe(1);
    expect(score.breakdown.stagesSkipped).toBe(2);
    expect(score.breakdown.stagesFailed).toBe(1);
  });

  it('penalises repeated attempts (attemptEfficiency drops)', async () => {
    state.pipelineRuns = [
      { stageCode: { ingest: 'A' }, submittedAt: new Date(), totalRuntimeMs: 30000, passed: false },
      { stageCode: { ingest: 'A' }, submittedAt: new Date(), totalRuntimeMs: 30000, passed: false },
    ];
    const score = await orchestrator.computePipelineScore({
      userId: 'u1',
      pipelineProblemId: 'p1',
      scenarioId: null,
      stageResults: [{ status: 'passed' }],
      codeMap: { ingest: 'A' },
      thisRuntimeMs: 30000,
    });
    expect(score.breakdown.attemptNumber).toBe(3);
    expect(score.breakdown.attemptEfficiency).toBe(0.8);
  });

  it('detects shotgun debugging (identical code across attempts)', async () => {
    state.pipelineRuns = [
      { stageCode: { ingest: 'A' }, submittedAt: new Date(), totalRuntimeMs: 30000, passed: false },
      { stageCode: { ingest: 'A' }, submittedAt: new Date(), totalRuntimeMs: 30000, passed: false },
    ];
    const score = await orchestrator.computePipelineScore({
      userId: 'u1',
      pipelineProblemId: 'p1',
      scenarioId: null,
      stageResults: [{ status: 'passed' }],
      codeMap: { ingest: 'A' },
      thisRuntimeMs: 30000,
    });
    expect(score.breakdown.noShotgun).toBe(0.5);
  });

  it('rewards a code fix (changed stageCode from previous attempt)', async () => {
    state.pipelineRuns = [
      { stageCode: { ingest: 'OLD' }, submittedAt: new Date(), totalRuntimeMs: 30000, passed: false },
      { stageCode: { ingest: 'OLD' }, submittedAt: new Date(), totalRuntimeMs: 30000, passed: false },
      { stageCode: { ingest: 'OLD' }, submittedAt: new Date(), totalRuntimeMs: 30000, passed: false },
      { stageCode: { ingest: 'OLD' }, submittedAt: new Date(), totalRuntimeMs: 30000, passed: false },
    ];
    const fixed = await orchestrator.computePipelineScore({
      userId: 'u1',
      pipelineProblemId: 'p1',
      scenarioId: null,
      stageResults: [{ status: 'passed' }],
      codeMap: { ingest: 'NEW' },
      thisRuntimeMs: 30000,
    });
    const shotgun = await orchestrator.computePipelineScore({
      userId: 'u1',
      pipelineProblemId: 'p1',
      scenarioId: null,
      stageResults: [{ status: 'failed' }, { status: 'skipped' }],
      codeMap: { ingest: 'OLD' },
      thisRuntimeMs: 30000,
    });
    // Exit criterion of Section 11J: a code fix scores higher than
    // shotgun debugging at the same attempt count.
    expect(fixed.total).toBeGreaterThan(shotgun.total);
    expect(fixed.breakdown.noShotgun).toBe(1);
    expect(shotgun.breakdown.noShotgun).toBe(0.5);
  });

  it('plan exit criterion: 1-submission fix > 5-submission shotgun', async () => {
    state.pipelineRuns = [];
    const oneShot = await orchestrator.computePipelineScore({
      userId: 'u1',
      pipelineProblemId: 'p1',
      scenarioId: null,
      stageResults: [{ status: 'passed' }, { status: 'passed' }],
      codeMap: { ingest: 'A' },
      thisRuntimeMs: 30000,
    });
    state.pipelineRuns = Array.from({ length: 4 }, () => ({
      stageCode: { ingest: 'A' },
      submittedAt: new Date(),
      totalRuntimeMs: 30000,
      passed: false,
    }));
    const fiveShot = await orchestrator.computePipelineScore({
      userId: 'u1',
      pipelineProblemId: 'p1',
      scenarioId: null,
      stageResults: [{ status: 'passed' }, { status: 'passed' }],
      codeMap: { ingest: 'A' },
      thisRuntimeMs: 30000,
    });
    expect(oneShot.total).toBeGreaterThan(fiveShot.total);
  });

  it('falls back to defaults when the previous-attempts lookup throws', async () => {
    // Force a throw by replacing the PipelineRun mock mid-test.
    const Module = require('module');
    const origLoad = Module._load;
    Module._load = function (req, parent, ...rest) {
      if (req.endsWith('/models/PipelineRun')) {
        return {
          find: () => ({
            sort: () => ({
              limit: () => ({
                select: async () => { throw new Error('boom'); },
              }),
            }),
          }),
        };
      }
      return origLoad.call(this, req, parent, ...rest);
    };
    const score = await orchestrator.computePipelineScore({
      userId: 'u1',
      pipelineProblemId: 'p1',
      scenarioId: null,
      stageResults: [{ status: 'passed' }],
      codeMap: { ingest: 'A' },
      thisRuntimeMs: 30000,
    });
    // Falls back to attempt #1 defaults: operational = 1.0.
    expect(score.breakdown.attemptNumber).toBe(1);
    expect(score.operational).toBe(1);
    Module._load = origLoad;
  });
});

describe('getDiagnosticsMode / shouldPersistDiagnostics', () => {
  const originalEnv = process.env.PIPELINE_DIAGNOSTICS_MODE;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.PIPELINE_DIAGNOSTICS_MODE;
    } else {
      process.env.PIPELINE_DIAGNOSTICS_MODE = originalEnv;
    }
  });

  it('defaults to "always"', () => {
    delete process.env.PIPELINE_DIAGNOSTICS_MODE;
    expect(orchestrator.getDiagnosticsMode()).toBe('always');
  });

  it('falls back to "always" for unknown values', () => {
    process.env.PIPELINE_DIAGNOSTICS_MODE = 'bogus';
    expect(orchestrator.getDiagnosticsMode()).toBe('always');
  });

  it('"on-failure" persists only for failed/error stages', () => {
    process.env.PIPELINE_DIAGNOSTICS_MODE = 'on-failure';
    expect(orchestrator.shouldPersistDiagnostics('passed')).toBe(false);
    expect(orchestrator.shouldPersistDiagnostics('failed')).toBe(true);
    expect(orchestrator.shouldPersistDiagnostics('error')).toBe(true);
    expect(orchestrator.shouldPersistDiagnostics('skipped')).toBe(false);
  });

  it('"always" persists for every stage', () => {
    process.env.PIPELINE_DIAGNOSTICS_MODE = 'always';
    expect(orchestrator.shouldPersistDiagnostics('passed')).toBe(true);
    expect(orchestrator.shouldPersistDiagnostics('failed')).toBe(true);
  });

  it('"never" never persists', () => {
    process.env.PIPELINE_DIAGNOSTICS_MODE = 'never';
    expect(orchestrator.shouldPersistDiagnostics('failed')).toBe(false);
    expect(orchestrator.shouldPersistDiagnostics('passed')).toBe(false);
  });
});
