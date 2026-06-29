const mongoose = require('mongoose');
const Problem = require('./models/Problem');
require('dotenv').config();

const GPU_PROBLEMS = [
  {
    title: "GPU Accelerated Column Sum",
    slug: "gpu-column-sum",
    description: `Given a massive dataset of 10 million rows, calculate the sum of a specific numeric column. 
    
Use the `cudf` library to perform this operation on the GPU. A standard Pandas/Python loop will likely time out (TLE) due to the data scale.`,
    difficulty: "Medium",
    category: "GPU-Data",
    examples: [
      {
        input: "column_name='value', rows=1000000",
        output: "sum_value",
        explanation: "Calculates the sum of the 'value' column across 1 million rows using GPU acceleration."
      }
    ],
    constraints: "Dataset size up to 10^7 rows, values are floats.",
    hints: [
      "Import cudf as cp",
      "Use cp.DataFrame to load the data and .sum() for aggregation."
    ],
    solution: {
      explanation: "Using cudf.DataFrame allows the sum operation to be parallelized across thousands of CUDA cores, reducing runtime from seconds to milliseconds.",
      code: `import cudf
def solution(column_name, rows):
    # Simulate creating a large dataframe on GPU
    df = cudf.DataFrame({'value': [1.0] * rows})
    return df[column_name].sum()`,
      complexity: {
        time: "O(n/p) where p is number of CUDA cores",
        space: "O(n) on GPU memory"
      }
    },
    testCases: [
      { input: "'value', 1000000", output: "1000000.0", visible: true },
      { input: "'value', 5000000", output: "5000000.0", visible: false }
    ],
    tags: ["GPU", "cuDF", "Data Engineering"],
    submissions: 0,
    accepted: 0,
    acceptanceRate: 0
  },
  {
    title: "Optimal Delivery Route",
    slug: "optimal-delivery-route",
    description: `You are given a set of coordinates for delivery locations. Find the optimal route that visits all locations and returns to the start with the minimum distance.
    
Use the `cuopt` library to solve this Vehicle Routing Problem (VRP).`,
    difficulty: "Hard",
    category: "GPU-Opt",
    examples: [
      {
        input: "locations=[(0,0), (1,1), (2,2)]",
        output: "route_indices",
        explanation: "Finds the shortest Hamiltonian path."
      }
    ],
    constraints: "Up to 1000 locations.",
    hints: [
      "Import cuopt",
      "Use cuopt.routing.solve() to compute the optimal path."
    ],
    solution: {
      explanation: "cuOpt uses GPU acceleration to explore millions of routing combinations per second, solving VRPs that are computationally impossible for CPUs.",
      code: `import cuopt
def solution(locations):
    # simplified cuOpt call
    model = cuopt.RoutingModel()
    model.add_nodes(locations)
    solution = model.solve()
    return solution.route`,
      complexity: {
        time: "O(GPU-accelerated heuristic)",
        space: "O(nodes^2)"
      }
    },
    testCases: [
      { input: "[(0,0), (1,1), (2,2)]", output: "[0, 1, 2, 0]", visible: true }
    ],
    tags: ["GPU", "cuOpt", "Optimization"],
    submissions: 0,
    accepted: 0,
    acceptanceRate: 0
  }
];

async function seedGPUProblems() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/python-leetcode');
    const result = await Problem.insertMany(GPU_PROBLEMS);
    console.log(`✅ Seeded ${result.length} GPU problems`);
    await mongoose.connection.close();
  } catch (err) {
    console.error('❌ Error seeding GPU problems:', err);
    process.exit(1);
  }
}

seedGPUProblems();
