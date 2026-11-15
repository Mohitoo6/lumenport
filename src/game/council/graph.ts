/**
 * The council as an explicit state machine.
 *
 *   detect -> triage -> debate_r1 -> [debate_r2] -> synthesis -> guardrails -> hitl -> execute -> done
 *
 * Each node is one stage with one job; the edges are the only moves allowed. Code that
 * runs a meeting calls `go()` to move on, and an illegal move throws, so the order of the
 * pipeline is enforced in one place instead of being implied by the order of some awaits.
 * The transition log is what the telemetry panel draws.
 */

export const NODES = ['detect', 'triage', 'debate_r1', 'debate_r2', 'synthesis', 'guardrails', 'hitl', 'execute', 'done', 'aborted'] as const;
export type GraphNode = (typeof NODES)[number];

export const NODE_INFO: Record<GraphNode, { label: string; does: string; llm: boolean }> = {
  detect: { label: 'Trigger', does: 'Detectors watch the simulation; a problem that persists raises a trigger.', llm: false },
  triage: { label: 'Triage', does: 'Every ministry scores how urgent the trigger is for its portfolio; the top scorers are seated.', llm: false },
  debate_r1: { label: 'Round 1', does: 'The lead proposes; the others react in parallel, each from its own context.', llm: true },
  debate_r2: { label: 'Round 2', does: 'Only if contested: challengers and the lead answer each other once.', llm: true },
  synthesis: { label: 'Chair', does: 'The Chief Secretary weighs the positions and recommends one option.', llm: true },
  guardrails: { label: 'Guardrails', does: 'Code checks the recommendation against the game rules and the facts shown.', llm: false },
  hitl: { label: 'Mayor', does: 'Human in the loop: the mayor approves, overrules or defers.', llm: false },
  execute: { label: 'Execute', does: 'The chosen option runs as one transaction and is reconciled with its payload.', llm: false },
  done: { label: 'Done', does: 'The decision is written to memory.', llm: false },
  aborted: { label: 'Aborted', does: 'The meeting was closed before a decision.', llm: false },
};

/** The moves the pipeline may make. Anything else is a bug. */
export const EDGES: Record<GraphNode, readonly GraphNode[]> = {
  detect: ['triage'],
  triage: ['debate_r1', 'aborted'],
  // Round 2 is a conditional edge: taken only when round 1 ends in disagreement.
  debate_r1: ['debate_r2', 'synthesis', 'aborted'],
  debate_r2: ['synthesis', 'aborted'],
  synthesis: ['guardrails', 'aborted'],
  guardrails: ['hitl', 'aborted'],
  // The mayor may approve (execute), defer (done), or send the council back to debate.
  hitl: ['execute', 'done', 'debate_r1', 'aborted'],
  // A refused execution returns the choice to the mayor.
  execute: ['done', 'hitl'],
  done: [],
  aborted: [],
};

export interface Transition {
  from: GraphNode;
  to: GraphNode;
  /** Milliseconds since the trace began. */
  at: number;
  /** Why this edge was taken, in words. */
  reason: string;
}

export class GraphState {
  node: GraphNode = 'detect';
  readonly history: Transition[] = [];
  private readonly t0: number;

  constructor(
    private readonly onChange: () => void = () => {},
    now: () => number = () => Date.now(),
  ) {
    this.now = now;
    this.t0 = now();
  }

  private readonly now: () => number;

  can(to: GraphNode): boolean {
    return EDGES[this.node].includes(to);
  }

  go(to: GraphNode, reason: string): void {
    if (!this.can(to)) throw new Error(`Council graph: illegal transition ${this.node} -> ${to}`);
    this.history.push({ from: this.node, to, at: this.now() - this.t0, reason });
    this.node = to;
    this.onChange();
  }

  /** Moves on only if the edge exists: for teardown paths that may run from any node. */
  tryGo(to: GraphNode, reason: string): boolean {
    if (!this.can(to)) return false;
    this.go(to, reason);
    return true;
  }

  visited(node: GraphNode): boolean {
    return node === 'detect' || this.history.some((t) => t.to === node);
  }
}
