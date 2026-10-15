import { createTempRepo, writeFixtureProvider, cleanupRepo } from './provider-recovery.js';
export { createTempRepo, writeFixtureProvider, cleanupRepo };
import path from 'node:path';

// Fixture provider content copied from the original test.
const fixtureProviderSource = `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const prompt = args.at(-1);
const role = prompt.match(/^You are Strata's ([^.]+).*?/)?.[1];
const worker = args[0] === 'run';
const repo = process.cwd();
const trace = path.join(path.dirname(process.argv[1]), 'trace.jsonl');
fs.appendFileSync(trace, JSON.stringify({role, worker, args}) + '\n');
function respond(text){
  console.log(JSON.stringify(worker ? {type:'text',text} : {type:'item.completed',item:{type:'agent_message',text}}));
}
if (role === 'explore agent' && worker) {
  const invalid = (callID)=>({type:'tool_use',part:{tool:'glob',callID,state:{status:'error',error:"Model tried to call unavailable tool 'invalid'. Available tools: glob, grep, read."}}});
  if (args.includes('--invalid-tools')){
    let count=0;setInterval(()=>console.log(JSON.stringify(invalid('call-'+(++count)))),20);
  } else if (args.includes('--duplicate-error')){
    for(let i=0;i<3;i++) console.log(JSON.stringify(invalid('same-call')));
    respond('Recovered after one invalid call');
  } else if (args.includes('--ordinary-tool-error')){
    for(let i=0;i<3;i++) console.log(JSON.stringify({type:'tool_use',part:{tool:'glob',state:{status:'error',error:'ripgrep execution failed'}}}));
    respond('Recovered after tool failures');
  } else if (args.includes('--nonzero-error')){
    console.log(JSON.stringify({type:'text',part:{text:'unrelated transcript'}}));
    process.stdout.write(JSON.stringify({type:'error',error:{name:'UnknownError',data:{message:JSON.stringify({message:'unexpected tokens remaining in message header',type:'BadRequestError',code:400})}}}));
    process.exitCode=1;
  } else {
    if (args.includes('--mutate')) fs.writeFileSync(path.join(repo,'README.md'),'unauthorized');
    console.log(JSON.stringify({type:'error',error:{data:{message:'Provider response headers timed out'}}}));
  }
} else if (role === 'explore agent') {
  if (args[args.indexOf('--sandbox')+1] !== 'read-only') throw new Error('Recovery must be read-only');
  respond('Recovered exploration');
} else if (role === 'epic coordinator') {
  respond(JSON.stringify(prompt.includes('## task\nIdentify')
    ? {exploration_tasks:[{question:'Inspect the fixture'}]}
    : {blockers:[],stages:[{id:'fixture',title:'fixture',objective:'Implement fixture',dependencies:[],completion_criteria:['Checks pass']}]}));
} else if (role === 'stage coordinator') {
  respond(JSON.stringify({implementation_tasks:[{task:'Implement fixture'}]}));
} else if (role === 'implementer') {
  fs.mkdirSync(path.join(repo,'src'),{recursive:true});
  fs.writeFileSync(path.join(repo,'src','fixture.ts'), '// implemented\n');
  respond('Implemented fixture');
} else if (role === 'tester' || role === 'validator') {
  respond(JSON.stringify({status:'pass',findings:[],summary:'Fixture verified'}));
} else if (role === 'archivist') {
  fs.mkdirSync(path.join(repo,'memory'),{recursive:true});
  fs.writeFileSync(path.join(repo,'memory','snapshot.json'),'{}');
  respond('Archived');
} else {
  respond('Unrecognized role');
}`;

export function setupFixture(repoPath: string, scriptName = 'fixture-provider.js') {
  writeFixtureProvider(repoPath, scriptName, fixtureProviderSource);
  const scriptPath = path.join(repoPath, scriptName);
  return scriptPath;
}
