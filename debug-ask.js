import { ask } from './src/runtime/ask.js';

// Simulate what the test is doing
const model = { provider: 'opencode', model: '', command: '', timeout_seconds: 5, extra_args: [] };
const repo = '/tmp/test';

// Mock the invoke function to return what the test script would return
const originalInvoke = require('./src/providers.js').invoke;

// We'll mock the agent script behavior
const mockInvoke = async (modelParam, promptParam, repoParam, roleParam, options) => {
  console.log(`Agent received prompt: "${promptParam}"`);
  
  // Simulate second call (calls===2)
  const text = JSON.stringify({status:'pass',summary:promptParam.includes('Verified existing source paths: src/runtime/types.ts')?'ok':'missing'});
  console.log(`Agent returning text: ${text}`);
  
  return {
    text,
    model: 'test-model',
    prompt_tokens: 7,
    completion_tokens: 3,
    total_tokens: 10
  };
};

// Temporarily replace the invoke function
require('./src/providers.js').invoke = mockInvoke;

ask({ worker: model, strong: model }, 'Implement Agent', { repo, text: 'Edit `src/runtime/types.ts`.' }, 'context')
  .then(result => {
    console.log('Result:', result);
    console.log('Summary:', result.summary);
  })
  .catch(err => {
    console.error('Error:', err);
  })
  .finally(() => {
    // Restore the original function
    require('./src/providers.js').invoke = originalInvoke;
  });