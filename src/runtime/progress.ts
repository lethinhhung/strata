export interface RunTransition {
  type: 'run';
  subtype: 'start' | 'resume' | 'complete' | 'fail';
  timestamp: string;
}

export interface StageTransition {
  type: 'stage';
  subtype: 'start' | 'pending' | 'in_progress' | 'complete' | 'fail' | 'skip';
  stage_id: string;
  timestamp: string;
}

export interface AgentTransition {
   type: 'agent';
   subtype: 'explore' | 'implement' | 'review' | 'test' | 'validate' | 'archive' | 'epic_coordinator' | 'stage_coordinator' | 'custom';
   role?: string;
   stage_id: string;
   timestamp: string;
   duration_ms?: number;
}

export interface GateTransition {
  type: 'gate';
  subtype: 'review' | 'test' | 'validation' | 'checkpoint';
  stage_id: string;
  timestamp: string;
  passed: boolean;
}

export type ProgressEntry = RunTransition | StageTransition | AgentTransition | GateTransition;
