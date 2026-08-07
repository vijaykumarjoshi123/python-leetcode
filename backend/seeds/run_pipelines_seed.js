/**
 * Pipeline seed runner — Tier 3 / Section 11F.
 *
 * Loads seeds/pipeline_problems.js (the pipeline DAGs) and
 * seeds/pipeline_scenarios.js (failure-injection scenarios) into MongoDB.
 *
 * Bug #7 in TESTING_REPORT.md: previously there was a runner for regular
 * problems (run_problems_seed.js) but NO runner for pipeline data, so the
 * pipeline collections stayed empty and the Pipelines feature had no
 * content even after Bug #2 (async execution) was fixed. This file closes
 * that gap.
 *
 * Idempotent: upserts by (slug) for problems and (pipelineProblemId, slug)
 * for scenarios, so re-running won't duplicate or wipe anything.
 *
 * Usage:
 *   node seeds/run_pipelines_seed.js
 * or via npm (add to package.json scripts if desired).
 */

const mongoose = require('mongoose');
const PipelineProblem = require('../models/PipelineProblem');
const PipelineScenario = require('../models/PipelineScenario');
const PROBLEMS = require('./pipeline_problems');
const SCENARIOS = require('./pipeline_scenarios');
require('dotenv').config();

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/etlninja';
  try {
    await mongoose.connect(uri);
    console.log('Connected to MongoDB:', uri);

    // ---- Upsert pipeline problems ----
    let problemCount = 0;
    for (const p of PROBLEMS) {
      await PipelineProblem.findOneAndUpdate(
        { slug: p.slug },
        { $set: p },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      problemCount += 1;
      console.log(`Upserted pipeline problem: ${p.slug}`);
    }

    // ---- Upsert scenarios (resolve slug -> _id first) ----
    let scenarioCount = 0;
    for (const s of SCENARIOS) {
      const problem = await PipelineProblem.findOne({ slug: s.pipelineProblemSlug });
      if (!problem) {
        console.log(`SKIP scenario "${s.slug}" — parent problem "${s.pipelineProblemSlug}" not found`);
        continue;
      }
      await PipelineScenario.findOneAndUpdate(
        { pipelineProblemId: problem._id, slug: s.slug },
        {
          $set: {
            pipelineProblemId: problem._id,
            slug: s.slug,
            name: s.name,
            description: s.description,
            failures: s.failures,
            expectedDiagnosis: s.expectedDiagnosis,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      scenarioCount += 1;
      console.log(`Upserted scenario: ${s.slug} (problem ${s.pipelineProblemSlug})`);
    }

    console.log(`✅ Upserted ${problemCount} pipeline problems, ${scenarioCount} scenarios`);
    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error('❌ Error seeding pipelines:', err);
    try { await mongoose.connection.close(); } catch (e) { /* ignore */ }
    process.exit(1);
  }
}

run();
