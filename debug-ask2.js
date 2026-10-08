import { ask } from './dist/src/runtime/ask.js';

// This mimics what the test does
async function testAsk() {
  const repo = '/tmp/test-repo';
  // We need to create the file that the agent will verify exists
  import fs from 'node:fs';
  fs.mkdirSync(repo + '/src/runtime', { recursive: true });
  fs.writeFileSync(repo + '/src/runtime/types.ts', 'export type RunRecord = {};');
  
  const model = { provider: 'opencode', model: '', command: '', timeout_seconds: 5, extra_args: [] };
  
  // Mock invoke to return what the test agent would return
  const originalInvoke = await import('./dist/src/providers.js').then(m => ({ ...m, invoke: m.invoke }));
  
  let originalInvokeFunc;
  (async () => {
    const providersModule = await import('./dist/src/providers.js');
    originalInvokeFunc = providersModule.invoke;
    
    const mockInvoke = async (modelParam, promptParam, repoParam, roleParam, options) => {
      // Simulate the agent script on its second call
      const text = JSON.stringify({status:'pass',summary:promptParam.includes('Verified existing source paths: src/runtime/types.ts')?'ok':'missing'});
      
      return {
        text,
        model: 'test-model',
        prompt_tokens: 7,
        completion_tokens: 3,
        total_tokens: 10
      };
    };
    
    // Temporarily replace invoke
    providersModule.invoke = mockInvoke;
    
    try {
      const result = await ask({ worker: model, strong: model }, 'Implement Agent', { repo, text: 'Edit `src/runtime/types.ts`.' }, 'context');
      console.log('Result:', JSON.stringify(result, null, 2));
      console.log('Result.summary:', result.summary);
      return result;
    } finally {
      // Restore original invoke
      providersModule.invoke = originalInvokeFunc;
    }
  })();
}

testAsk().then(result => {
  if (result && result.summary === 'ok') {
    console.log('SUCCESS: Test would pass');
    process.exit(0);
  } else {
    console.log('FAILURE: Test would fail');
    process.exit(1);
  }
});