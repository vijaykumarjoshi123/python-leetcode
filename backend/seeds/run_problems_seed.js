const mongoose = require('mongoose');
const Problem = require('../models/Problem');
const PROBLEMS = require('./problems');
require('dotenv').config();

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/etlninja';
  try {
    await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
    console.log('Connected to MongoDB:', uri);

    let upserted = 0;
    for (const p of PROBLEMS) {
      const slug = p.slug;
      // Use findOneAndUpdate with upsert so this runner is idempotent.
      const doc = await Problem.findOneAndUpdate(
        { slug },
        { $set: p },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      if (doc) upserted += 1;
      console.log(`Upserted problem: ${slug}`);
    }

    console.log(`✅ Upserted ${upserted} problems`);
    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error('❌ Error seeding problems:', err);
    try { await mongoose.connection.close(); } catch (e) {}
    process.exit(1);
  }
}

run();
