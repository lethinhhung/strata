import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { executeRun } from './runtime/executeRun.js';
import { startRun } from './runtime/startRun.js';
import { resumeRun } from './runtime/resumeRun.js';
import { save } from './runtime/save.js';
import { loadRun } from './runtime/loadRun.js';
import { recordPath } from './runtime/time.js';
import { formatProgress } from './progress.js';
import type { ProgressEntry, RunRecord } from './runtime/types.js';
const git=(r:string,...a:string[])=>execFileSync('git',a,{cwd:r,encoding:'utf8'});
function setup(){const repo=fs.mkdtempSync(path.join(os.tmpdir(),'strata-progress-'));git(repo,'init','-q');git(repo,'config','user.email','strata@example.invalid');git(repo,'config','user.name','Strata');fs.writeFileSync(path.join(repo,'base'),'base');git(repo,'add','base');git(repo,'commit','-qm','base');return repo}
function agent(command:string,fail=''){const source=`#!/usr/bin/env node\nconst fs=require('node:fs'),p=process.argv.at(-1),r=p.match(/You are the Strata ([A-Za-z ]+)\\./)?.[1];\nif(r===${JSON.stringify(fail)})process.exit(1);\nif(r==='Implement Agent'){fs.mkdirSync('src',{recursive:true});fs.writeFileSync('src/work.ts','ok')}\nconst v=r==='Epic Coordinator'?(p.includes('Review epic criteria')?{status:'pass',findings:[]}:{summary:'test',decisions:[],stages:[{id:'one',title:'One',concern:'runtime',scope:['src/**'],dependencies:[],completion_criteria:['done'],checkpoint:'one'}]}):r==='Stage Coordinator'?(p.includes('LATEST REPORTS AND CHECK EVIDENCE')?(p.includes('\"gate_passed\": false')?{decision:'blocked',rationale:'test check failure'}:{decision:'ready',rationale:'checks pass'}):{implementation_task:'implement',review_focus:[],test_task:'test',validation_requirements:[]}):r==='Archivist'?{entries:[]}:{status:'pass',findings:[],files:[],summary:'ok',uncertainties:[],gates:[]};process.stdout.write(JSON.stringify({type:'text',part:{text:JSON.stringify(v)}})+'\\n')`;fs.writeFileSync(command,source);fs.chmodSync(command,0o755)}
function config(command:string,tests:any[]=[['node','-e','process.exit(0)']]){const model={provider:'opencode',model:'',command,timeout_seconds:10,extra_args:[]};const workflow={max_repairs:0,review_repair_attempts:0,test_repair_attempts:0,validation_repair_attempts:0,checkpoint:false,checkpoint_prefix:'strata',spec_paths:[],memory_path:'memory',test_commands:tests,quality_checks:[],require_agent_gates:true};return{worker:model,strong:model,workflow, path:''}}
function record(repo:string,id='run',status='running'):RunRecord{const stage={id:'one',title:'One',concern:'runtime',scope:['src/**','agent'],dependencies:[],completion_criteria:['done'],checkpoint:'one',status:status==='failed'?'failed':'pending',phase_results:[]};return{schema_version:1,run_id:id,status,created_at:'',repository:repo,epic:'test',epic_path:'epic.md',epic_absolute_path:'',config:null as any,stages:[stage],attempts:[],events:[],memory_consulted:{paths:[],excerpt:''},progress:[],failure:status==='failed'?{message:'original',timestamp:'old'}:undefined}}
async function withRepo<T>(callback: (repo: string) => Promise<T>): Promise<T> {
  const repo = setup();
  try {
    return await callback(repo);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}
test('new and persisted runs persist typed progress transitions',async()=>{
  await withRepo(async(repo)=>{
    const cmd = path.join(repo,'agent');
    agent(cmd);
    const cfg = config(cmd);
    const r = record(repo);
    await executeRun(repo,r,cfg,path.join(repo,'docs/temps/run.md'));
    assert.equal(r.progress[0].type,'run');
    assert.ok(r.progress.some(x=>x.type==='agent'&&x.subtype==='stage_coordinator'));
    assert.ok(r.progress.some(x=>x.type==='gate'&&x.subtype==='validation'&&x.passed));
    assert.ok(r.progress.some(x=>x.type==='stage'&&x.subtype==='complete'));
    const prior=record(repo,'resume','failed');
    save(prior,path.join(repo,'docs/temps/resume.md'));
    const resumed=await resumeRun(repo,path.join(repo,'docs/temps/resume.md'),cfg);
    assert.ok(resumed.progress.some(x=>x.type==='run'&&x.subtype==='resume'));
    assert.ok(resumed.progress.some(x=>x.type==='run'&&x.subtype==='complete'));
  });
});
test('failed test and review gates are recorded',async()=>{
  await withRepo(async(repo)=>{
    const cmd = path.join(repo,'agent');
    agent(cmd);
    const r = record(repo,'gate');
    await assert.rejects(executeRun(repo,r,config(cmd,[['node','-e','process.exit(1)']]),path.join(repo,'docs/temps/run.md')));
    assert.ok(r.progress.some(x=>x.type==='gate'&&x.subtype==='test'&&!x.passed));
    const review=record(repo,'review');
    agent(cmd,'Review Agent');
    await executeRun(repo,review,config(cmd),path.join(repo,'docs/temps/review.md'));
    assert.ok(review.progress.some(x=>x.type==='gate'&&x.subtype==='review'&&!x.passed));
    assert.equal(review.status, 'complete');
  });
});
test('resume preserves prior failure after a new failure',async()=>{
  await withRepo(async(repo)=>{
    const cmd = path.join(repo,'agent');
    agent(cmd,'Explore Agent');
    const r = record(repo,'failure','failed');
    const file = path.join(repo,'docs/temps/run.md');
    save(r,file);
    await assert.rejects(resumeRun(repo,file,config(cmd)));
    const saved=JSON.parse(fs.readFileSync(file,'utf8').match(/```json\s*([\s\S]*?)```/)![1]);
    assert.ok(saved.failure_history.some((x:any)=>x.message==='original'));
    assert.ok(saved.progress.some((x:any)=>x.type==='stage'&&x.subtype==='fail'));
  });
});
test('startRun streams progress to its listener',async()=>{
  await withRepo(async(repo)=>{
    const cmd = path.join(repo,'agent');
    agent(cmd);
    git(repo,'add','agent');
    git(repo,'commit','-qm','agent');
    fs.writeFileSync(path.join(repo,'epic.md'),'test epic');
    const cfg:any=config(cmd); cfg.path=path.join(repo,'.strata.toml'); const seen:any[]=[];
    const result = await startRun(repo,'epic.md',cfg,(entry)=>seen.push(entry));
    assert.ok(seen.some(x=>x.type==='run'&&x.subtype==='start')); assert.ok(seen.some(x=>x.type==='agent'&&x.subtype==='epic_coordinator'));
    assert.ok(seen.some(x=>x.type==='run'&&x.subtype==='complete'));
    assert.deepEqual(seen, result.progress);
  });
});
test('completed agent steps persist durations in new and resumed runs', async () => {
  await withRepo(async(repo) => {
    const cmd = path.join(repo, 'agent'); agent(cmd, '');
    git(repo, 'add', 'agent');
    git(repo, 'commit', '-qm', 'agent');
    fs.writeFileSync(path.join(repo, 'epic.md'), 'test epic');
    const cfg = config(cmd); cfg.path = path.join(repo, '.strata.toml');
    const freshOutput: string[] = [];
    const fresh = await startRun(repo, 'epic.md', cfg, entry => freshOutput.push(formatProgress(entry)));
    const freshSteps = fresh.progress.filter((e: any) => e.type === 'agent'); assert.ok(freshSteps.length > 0); for (const event of freshSteps) assertDuration(event);
    assert.ok(freshOutput.some(line => / — \d+\.\d+s$/.test(line)));
    const savedFresh = loadRun(recordPath(repo, fresh.run_id)); for (const event of savedFresh.progress.filter((e: any) => e.type === 'agent')) assertDuration(event);
    const resumeFile = path.join(repo, 'docs/temps/resume.md'); const resumable = recordForTiming(repo, 'resume', 'failed');
    resumable.progress.push({ type: 'agent', subtype: 'explore', stage_id: 'one', timestamp: '2026-09-29T00:00:00.000Z' });
    save(resumable, resumeFile);
    const resumeOutput: string[] = []; const resumedRecord = await resumeRun(repo, resumeFile, cfg, entry => resumeOutput.push(formatProgress(entry)));
    const resumedAgentEvents = resumedRecord.progress.filter((e: any) => e.type === 'agent');
    assert.ok(resumedAgentEvents.length > 1); assert.equal('duration_ms' in resumedAgentEvents[0], false); for (const event of resumedAgentEvents.slice(1)) assertDuration(event);
    assert.ok(resumeOutput.some(line => / — \d+\.\d+s$/.test(line)));
    const oldEvent: ProgressEntry = { type: 'agent', subtype: 'explore', stage_id: 'one', timestamp: '2026-09-29T00:00:00.000Z' };
    assert.match(formatProgress(oldEvent), /agent explore/);
  });
});

function recordForTiming(repo: string, id: string, status = 'running'): RunRecord {
  const result = record(repo, id, status); if (status === 'failed') result.stages[0].status = 'failed';
  return result;
}

function assertDuration(event: ProgressEntry) {
  assert.equal(event.type, 'agent');
  if (event.type === 'agent') { assert.equal(typeof event.duration_ms, 'number'); assert.ok(Number.isFinite(event.duration_ms)); }
}
