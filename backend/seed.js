// Sample problems to seed the database.
// Run this with: node seed.js
// or via the npm script: npm run seed
//
// Bug 2 fix (Section 11Z): this seed is now idempotent — it uses
// `findOneAndUpdate({slug}, problem, {upsert:true})` per problem so
// re-running it doesn't fail with duplicate-key errors and doesn't
// wipe legitimate user submissions / acceptance rates. We key on
// `slug` rather than `title` because the Problem schema declares
// `slug` as unique (titles are not guaranteed unique across re-runs
// if we ever localise them).
//
// We also add executorType + track + starterCode to every seeded
// problem so the frontend can render the right pill and the
// editor can pre-fill the right boilerplate.

const mongoose = require('mongoose');
const Problem = require('./models/Problem');
// Bug #7: also seed pipeline problems + scenarios so the Tier-3 Pipelines
// feature has content. Without this, db.pipelineproblems stays empty and
// the Pipelines index page lists nothing.
const PipelineProblem = require('./models/PipelineProblem');
const PipelineScenario = require('./models/PipelineScenario');
const PIPELINE_PROBLEMS = require('./seeds/pipeline_problems');
const PIPELINE_SCENARIOS = require('./seeds/pipeline_scenarios');
require('dotenv').config();

// Bug 5 fix: the Problem schema declares starterCode as a
// Map<executorType, String>, not a plain String. Earlier versions of
// this seed set `starterCode: PY_STARTER` directly, which Mongoose
// rejected on every problem with a CastError ("Cast to Map failed for
// value '...string...'"). Wrapping the boilerplate in `{ python: ... }`
// makes the upsert succeed AND lets the frontend pick the right
// starter per executorType at runtime.
const PY_STARTER_MAP = {
  python: `# Write your solution here
def solution(nums, target):
    # Replace this with your implementation.
    return []
`,
};

const SQL_STARTER_MAP = {
  sql: `-- Write your solution here
SELECT 1 AS result;
`,
};

const SAMPLE_PROBLEMS = [
  {
    title: 'Two Sum',
    slug: 'two-sum',
    description: `Given an array of integers nums and an integer target, return the indices of the two numbers that add up to target.

You may assume that each input has exactly one solution, and you cannot use the same element twice.

You can return the answer in any order.`,
    difficulty: 'Easy',
    category: 'Arrays',
    executorType: 'python',
    track: 'foundations',
    starterCode: PY_STARTER_MAP,
    examples: [
      {
        input: 'nums = [2,7,11,15], target = 9',
        output: '[0,1]',
        explanation: 'nums[0] + nums[1] == 9, so we return [0, 1].'
      },
      {
        input: 'nums = [3,2,4], target = 6',
        output: '[1,2]',
        explanation: 'nums[1] + nums[2] == 6, so we return [1, 2].'
      }
    ],
    constraints: '2 <= nums.length <= 10^4, -10^9 <= nums[i] <= 10^9, -10^9 <= target <= 10^9',
    hints: [
      'A really brute force way would be to search for all pairs of numbers that add up to the target.',
      'Think about using a hash map to store the numbers you have seen so far.'
    ],
    solution: {
      explanation: 'Use a hash map to store numbers and their indices. For each number, check if target - number exists in the map.',
      code: `def twoSum(nums, target):
    num_map = {}
    for i, num in enumerate(nums):
        complement = target - num
        if complement in num_map:
            return [num_map[complement], i]
        num_map[num] = i
    return []`,
      complexity: {
        time: 'O(n)',
        space: 'O(n)'
      }
    },
    testCases: [
      { input: '[2,7,11,15], 9', output: '[0,1]', visible: true },
      { input: '[3,2,4], 6', output: '[1,2]', visible: true },
      { input: '[3,3], 6', output: '[0,1]', visible: false }
    ],
    tags: ['Array', 'Hash Table'],
    submissions: 150000,
    accepted: 112500,
    acceptanceRate: 75.0
  },
  {
    title: 'Reverse String',
    slug: 'reverse-string',
    description: 'Write a function that reverses a string. The input string is given as an array of characters s.',
    difficulty: 'Easy',
    category: 'Strings',
    executorType: 'python',
    track: 'foundations',
    starterCode: PY_STARTER_MAP,
    examples: [
      {
        input: 's = ["h","e","l","l","o"]',
        output: '["o","l","l","e","h"]',
        explanation: "The string 'hello' reversed is 'olleh'"
      }
    ],
    constraints: '1 <= s.length <= 10^5, s[i] is a printable ascii character.',
    hints: [
      'Reverse means the first character becomes last, second becomes second-to-last, etc.',
      'Try using two pointers approach.'
    ],
    solution: {
      explanation: 'Use two pointers from both ends and swap them.',
      code: `def reverseString(s):
    left, right = 0, len(s) - 1
    while left < right:
        s[left], s[right] = s[right], s[left]
        left += 1
        right -= 1`,
      complexity: {
        time: 'O(n)',
        space: 'O(1)'
      }
    },
    testCases: [
      { input: '["h","e","l","l","o"]', output: '["o","l","l","e","h"]', visible: true },
      { input: '["H","a","n","n","a","h"]', output: '["h","a","n","n","a","H"]', visible: false }
    ],
    tags: ['String', 'Two Pointers'],
    submissions: 200000,
    accepted: 160000,
    acceptanceRate: 80.0
  },
  {
    title: 'Longest Substring Without Repeating Characters',
    slug: 'longest-substring',
    description: 'Given a string s, find the length of the longest substring without repeating characters.',
    difficulty: 'Medium',
    category: 'Strings',
    executorType: 'python',
    track: 'foundations',
    starterCode: PY_STARTER_MAP,
    examples: [
      {
        input: 's = "abcabcbb"',
        output: '3',
        explanation: 'The answer is "abc", with the length of 3.'
      }
    ],
    constraints: '0 <= s.length <= 5 * 10^4',
    hints: [
      'Use sliding window technique.',
      'Maintain a set of characters in the current window.'
    ],
    solution: {
      explanation: 'Use a sliding window with two pointers and a set to track characters.',
      code: `def lengthOfLongestSubstring(s):
    char_index = {}
    max_length = 0
    start = 0

    for i, char in enumerate(s):
        if char in char_index and char_index[char] >= start:
            start = char_index[char] + 1
        char_index[char] = i
        max_length = max(max_length, i - start + 1)

    return max_length`,
      complexity: {
        time: 'O(n)',
        space: 'O(min(m, n))'
      }
    },
    testCases: [
      { input: '"abcabcbb"', output: '3', visible: true },
      { input: '"bbbbb"', output: '1', visible: true }
    ],
    tags: ['String', 'Sliding Window', 'Hash Table'],
    submissions: 500000,
    accepted: 300000,
    acceptanceRate: 60.0
  }
];

async function seedDatabase() {
  try {
    await mongoose.connect(
      process.env.MONGODB_URI || 'mongodb://localhost:27017/etlninja',
    );

    // Idempotent upsert per problem. This means re-running the seed
    // doesn't fail with E11000 duplicate-key errors AND doesn't wipe
    // user-attached fields like submissions/accepted/acceptanceRate
    // (we only upsert fields from SAMPLE_PROBLEMS, but we don't
    // delete existing problems first).
    let created = 0;
    let updated = 0;
    for (const problem of SAMPLE_PROBLEMS) {
      const result = await Problem.findOneAndUpdate(
        { slug: problem.slug },
        problem,
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true,
          runValidators: true,
        },
      );
      if (result.createdAt && Date.now() - new Date(result.createdAt).getTime() < 5000) {
        created++;
      } else {
        updated++;
      }
    }

    console.log(`✅ Seed complete — ${created} created, ${updated} updated`);

    // ---- Pipeline problems + scenarios (Bug #7) ----
    let pCount = 0;
    for (const p of PIPELINE_PROBLEMS) {
      await PipelineProblem.findOneAndUpdate(
        { slug: p.slug },
        { $set: p },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      pCount += 1;
    }
    let sCount = 0;
    for (const s of PIPELINE_SCENARIOS) {
      const parent = await PipelineProblem.findOne({ slug: s.pipelineProblemSlug });
      if (!parent) continue; // scenario whose parent problem isn't seeded
      await PipelineScenario.findOneAndUpdate(
        { pipelineProblemId: parent._id, slug: s.slug },
        {
          $set: {
            pipelineProblemId: parent._id,
            slug: s.slug,
            name: s.name,
            description: s.description,
            failures: s.failures,
            expectedDiagnosis: s.expectedDiagnosis,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      sCount += 1;
    }
    console.log(`✅ Pipeline seed complete — ${pCount} problems, ${sCount} scenarios`);

    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error('❌ Error seeding database:', err);
    process.exit(1);
  }
}

seedDatabase();
