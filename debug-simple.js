// Simulate the agent behavior
const prompt = 'Edit `src/runtime/types.ts`.';
const calls = 2;

const text = calls===1?'prose response':JSON.stringify({status:'pass',summary:prompt.includes('Verified existing source paths: src/runtime/types.ts')?'ok':'missing'});

console.log('Prompt:', prompt);
console.log('Calls:', calls);
console.log('Text:', text);
console.log('Includes check:', prompt.includes('Verified existing source paths: src/runtime/types.ts'));
console.log('Summary value:', prompt.includes('Verified existing source paths: src/runtime/types.ts')?'ok':'missing');

// Now parse the JSON
const parsed = JSON.parse(text);
console.log('Parsed object:', parsed);
console.log('Parsed summary:', parsed.summary);