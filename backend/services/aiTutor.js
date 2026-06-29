const axios = require('axios');

/**
 * AI Tutor Service using Claude to provide contextual hints.
 * It analyzes the problem description and the user's current code to suggest improvements.
 */
async function getAIHint(problem, userCode, submissionHistory = []) {
  try {
    // In a real production environment, this would call the Anthropic API directly.
    // For this implementation, we define the prompt logic that will be used.
    
    const prompt = `
      You are an expert Python and Data Engineering Tutor. 
      A user is struggling with the following problem:
      
      Title: ${problem.title}
      Description: ${problem.description}
      Constraints: ${problem.constraints}
      
      Current User Code:
      ```python
      ${userCode}
      ```
      
      Submission History:
      ${JSON.stringify(submissionHistory)}
      
      Task:
      Provide a subtle, helpful hint. Do NOT give the full solution.
      - If the problem is in the "GPU-Data" or "GPU-Opt" category, suggest how to use cuDF or cuOpt to optimize.
      - If the user has a "Time Limit Exceeded" error, explain the bottleneck and suggest a more efficient algorithmic approach or GPU acceleration.
      - If there is a "Runtime Error", help them debug the specific Python exception.
      
      Keep the hint encouraging and professional.
    `;

    // Mocking the API call for architectural demonstration. 
    // Replace with actual axios.post('https://api.anthropic.com/v1/messages', ...)
    return {
      hint: "Based on your code, it looks like you're using a standard Python loop. For this data scale, try leveraging 'cudf' to parallelize the operation on the GPU.",
      suggestion: "Look into cudf.DataFrame.sum() for a significant speedup."
    };
  } catch (err) {
    console.error('AI Tutor Error:', err);
    throw new Error('AI Tutor is currently unavailable');
  }
}

module.exports = { getAIHint };
