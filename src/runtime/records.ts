import type { ProgressEntry } from './progress.js';
import type { Workflow } from '../workflowConfig.js';

export interface Stage {
  id: string;
  title: string;
  concern: string;
  dependencies: string[];
  completion_criteria: string[];
  checkpoint: string;
  status: string;
  phase_results: any[];
  failure?: string;
  pushed?: boolean;
  push_evidence?: string;
  open_issues?: string[];
}
export interface Attempt { stage_id: string; number: number; passed: boolean; reason: string; findings: any[]; at: string }
export interface Event { type: 'repair' | 'final_repair'; stage_id: string; attempt?: number; details: any[]; at: string }
export interface ArchivistResult { status: 'complete'; entries: number; path?: string }
export interface Config {
  worker: any; strong: any;
  workflow: Workflow;
  path?: string;
}
export interface MemoryConsulted { paths: string[] }
export interface Plan { summary: string; decisions: any[] }
export interface FinalReview { status: 'pass' | 'fail'; findings: any[]; target_stage_id?: string }
export interface ValidateAgentResult { status: 'pass' | 'fail'; findings: any[]; gates: Array<{ name: string; passed: boolean; evidence: string }> }
export interface FinalValidation { result: ValidateAgentResult; observed_changed_paths: string[] }
export interface CheckResult { kind: string; command: string[]; exit_code: number; signal: NodeJS.Signals | null | undefined; stdout: string; stderr: string; passed: boolean }
export interface FailureDiagnostic { message: string; timestamp: string; stage_id?: string }
export interface RunRecord {
  schema_version: number; run_id: string; status: string; stages: Stage[]; events: Event[]; attempts: Attempt[];
  failure?: FailureDiagnostic; failure_history?: FailureDiagnostic[]; epic_checkpoint?: string; completed_at?: string;
  archival?: ArchivistResult; progress: ProgressEntry[]; created_at: string; repository: string; epic: string;
  epic_path: string; epic_absolute_path: string; config: Config; memory_consulted: MemoryConsulted; plan?: Plan;
  updated_at?: string; final_review?: FinalReview; final_validation?: FinalValidation;
  final_evidence?: CheckResult[]; final_validated_at?: string;
}
