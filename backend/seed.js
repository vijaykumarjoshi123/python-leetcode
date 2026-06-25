// Sample problems to seed the database
// Run this with: node seed.js

const mongoose = require('mongoose');
const Problem = require('./models/Problem');
require('dotenv').config();

const SAMPLE_PROBLEMS = [
  {
    title: "Two Sum",
    slug: "two-sum",
    description: `Given an array of integers nums and an integer target, return the indices of the two numbers that add up to target.

You may assume that each input has exactly one solution, and you cannot use the same element twice.

You can return the answer in any order.`,
    difficulty: "Easy",
    category: "Arrays",
    examples: [
      {
        input: "nums = [2,7,11,15], target = 9",
        output: "[0,1]",
        explanation: "nums[0] + nums[1] == 9, so we return [0, 1]."
      },
      {
        input: "nums = [3,2,4], target = 6",
        output: "[1,2]",
        explanation: "nums[1] + nums[2] == 6, so we return [1, 2]."
      }
    ],
    constraints: "2 <= nums.length <= 10^4, -10^9 <= nums[i] <= 10^9, -10^9 <= target <= 10^9",
    hints: [
      "A really brute force way would be to search for all pairs of numbers that add up to the target.",
      "Think about using a hash map to store the numbers you've seen so far."
    ],
    solution: {
      explanation: "Use a hash map to store numbers and their indices. For each number, check if target - number exists in the map.",
      code: `def twoSum(nums, target):
    num_map = {}
    for i, num in enumerate(nums):
        complement = target - num
        if complement in num_map:
            return [num_map[complement], i]
        num_map[num] = i
    return []`,
      complexity: {
        time: "O(n)",
        space: "O(n)"
      }
    },
    testCases: [
      { input: "[2,7,11,15], 9", output: "[0,1]", visible: true },
      { input: "[3,2,4], 6", output: "[1,2]", visible: true },
      { input: "[3,3], 6", output: "[0,1]", visible: false }
    ],
    tags: ["Array", "Hash Table"],
    submissions: 150000,
    accepted: 112500,
    acceptanceRate: 75.0
  },
  {
    title: "Reverse String",
    slug: "reverse-string",
    description: "Write a function that reverses a string. The input string is given as an array of characters s.",
    difficulty: "Easy",
    category: "Strings",
    examples: [
      {
        input: 's = ["h","e","l","l","o"]',
        output: '["o","l","l","e","h"]',
        explanation: "The string 'hello' reversed is 'olleh'"
      }
    ],
    constraints: "1 <= s.length <= 10^5, s[i] is a printable ascii character.",
    hints: [
      "Reverse means the first character becomes last, second becomes second-to-last, etc.",
      "Try using two pointers approach."
    ],
    solution: {
      explanation: "Use two pointers from both ends and swap them.",
      code: `def reverseString(s):
    left, right = 0, len(s) - 1
    while left < right:
        s[left], s[right] = s[right], s[left]
        left += 1
        right -= 1`,
      complexity: {
        time: "O(n)",
        space: "O(1)"
      }
    },
    testCases: [
      { input: '["h","e","l","l","o"]', output: '["o","l","l","e","h"]', visible: true },
      { input: '["H","a","n","n","a","h"]', output: '["h","a","n","n","a","H"]', visible: false }
    ],
    tags: ["String", "Two Pointers"],
    submissions: 200000,
    accepted: 160000,
    acceptanceRate: 80.0
  },
  {
    title: "Longest Substring Without Repeating Characters",
    slug: "longest-substring",
    description: "Given a string s, find the length of the longest substring without repeating characters.",
    difficulty: "Medium",
    category: "Strings",
    examples: [
      {
        input: 's = "abcabcbb"',
        output: "3",
        explanation: 'The answer is "abc", with the length of 3.'
      }
    ],
    constraints: "0 <= s.length <= 5 * 10^4",
    hints: [
      "Use sliding window technique.",
      "Maintain a set of characters in the current window."
    ],
    solution: {
      explanation: "Use a sliding window with two pointers and a set to track characters.",
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
        time: "O(n)",
        space: "O(min(m, n))"
      }
    },
    testCases: [
      { input: '"abcabcbb"', output: "3", visible: true },
      { input: '"bbbbb"', output: "1", visible: true }
    ],
    tags: ["String", "Sliding Window", "Hash Table"],
    submissions: 500000,
    accepted: 300000,
    acceptanceRate: 60.0
  }
];

async function seedDatabase() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/python-leetcode');
    
    // Clear existing problems
    await Problem.deleteMany({});
    
    // Insert sample problems
    const result = await Problem.insertMany(SAMPLE_PROBLEMS);
    console.log(`✅ Seeded ${result.length} problems`);
    
    await mongoose.connection.close();
  } catch (err) {
    console.error('❌ Error seeding database:', err);
    process.exit(1);
  }
}

seedDatabase();
