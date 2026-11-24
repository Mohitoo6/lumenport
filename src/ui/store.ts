import { signal } from '@preact/signals';
import { emptyReport, type BudgetReport, type Loan, type LoanOffer } from '../sim/economy/budget';
import type { OverlayId } from '../render/overlays/dataOverlay';
import type { RoadType } from '../sim/roads/types';
import type { SaveMeta } from '../sim/save/serialize';
import type { Speed } from '../sim/state';
import type { MinistryId } from '../game/council/ministries';
import type { Lang, Stance } from '../game/council/prompts';
import type { Post } from '../game/council/voices';
import type { AssistantAction } from '../game/assistant/assistant';
import type { Drift, Feasibility, FiscalLimits, StateDelta } from '../game/council/effects';
import type { VerdictReport } from '../game/council/guardrails';
import { EMPTY_STATS, type AiStats, type CouncilTrace, type TurnSource } from '../game/council/telemetry';
import type { TriageEntry } from '../game/council/triage';

export interface AssistantMessage {
  id: number;
  role: 'player' | 'assistant';
  text: string;
  actions?: AssistantAction[];
  /** Which model answered, or 'offline'. */
  source?: string;
  /** Figures in the answer that code could not find in the rules or the city data. */
  flags?: string[];
}

export type SeatState = 'waiting' | 'thinking' | 'speaking' | 'spoke' | 'silent' | 'failed';

export interface CouncilMessage {
  key: string;
  who: MinistryId | 'chief';
  round: number;
  stance?: Stance;
  option?: string;
  text: string;
  condition?: string;
  provider?: string;
  /** A deterministic stand-in spoke because the model could not. */
  standIn?: boolean;
  /** What the guardrails flagged in this statement. */
  flags?: string[];
}

export interface CouncilOptionView {
  id: string;
  title: string;
  gist: string;
  cost: number;
  hourly: number;
  facts: string[];
  /** The measured state-mutation payload, and whether the city can pay for it. */
  effects: StateDelta;
  feasibility: Feasibility;
  /** A loan that would cover the shortfall, when the treasury alone cannot pay. */
  financing?: { amount: number };
  /** How this option breaks the mayor's instruction, if it does. */
  violations?: string[];
  /** Ministers whose latest position backs this option. */
  backers: MinistryId[];
  hasActions: boolean;
  x?: number;
  z?: number;
}

/** Everything the council chamber shows. Replaced as a whole on every change. */
export interface CouncilView {
  phase: 'brief' | 'debate' | 'decided' | 'enacted' | 'error';
  issue: { key: string; title: string; summary: string; facts: string[]; lead: MinistryId; severity: number; x: number; z: number };
  options: CouncilOptionView[];
  seats: Array<{ id: MinistryId; state: SeatState; reason: string }>;
  chief: SeatState;
  messages: CouncilMessage[];
  round: number;
  decision?: { option: string; summary: string; dissent: string; conditions: string; guardrail: VerdictReport; source: TurnSource };
  error?: string;
  /** Where the words come from: 'AI' or 'Offline (no AI)'. */
  source: string;
  /** Every ministry's triage score: who was seated and why. */
  triage: TriageEntry[];
  /** The city's money limits every agent argues within. */
  limits: FiscalLimits;
  /** Past decisions the council was reminded of. */
  memory: string[];
  /** The parts of the mayor's instruction that code enforces in this meeting. */
  constraints: string[];
  /** Something about how the meeting is being run (for example, a fall back to offline). */
  notice?: string;
  /** False when the server has no AI keys: the brief offers a demo meeting instead. */
  aiReady: boolean;
  providers: string[];
  result?: { ok: boolean; text: string; observed?: StateDelta; drift?: Drift[] };
  lang: Lang;
  /** The statement being delivered right now, and how long it takes. */
  speaking?: { key: string; who: MinistryId | 'chief'; seconds: number };
}

/** Where the council's entrance is: flying to the town hall, in the chamber, or leaving. */
export type CinemaStage = 'off' | 'approach' | 'inside' | 'leaving';

export interface MinisterRequest {
  issueKey: string;
  minister: MinistryId;
  title: string;
  text: string;
  severity: number;
}

export interface IssueRow {
  key: string;
  title: string;
  lead: MinistryId;
  severity: number;
}

export type ToolId = 'none' | 'road' | 'zone' | 'place' | 'bulldoze' | 'metro';
export type RoadModeId = 'straight' | 'curve';
export type TimeMode = 'auto' | 'day' | 'night';

/** What the inspect panel shows for the selected building. */
export interface InspectData {
  title: string;
  subtitle: string;
  rows: Array<[label: string, value: string, tone?: 'good' | 'bad']>;
}

export interface Hint {
  text: string;
  tone: 'info' | 'ok' | 'bad';
}

/** Reactive values the HUD renders. The game writes them; components only read. */
const SCROLL_KEY = 'metropolis.scroll.v1';

function readScrollMode(): import('../game/input').ScrollMode {
  try {
    const v = localStorage.getItem(SCROLL_KEY);
    return v === 'zoom' || v === 'pan' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function saveScrollMode(mode: import('../game/input').ScrollMode): void {
  ui.scrollMode.value = mode;
  try {
    localStorage.setItem(SCROLL_KEY, mode);
  } catch {
    /* private window: the choice lasts until the page closes */
  }
}

export const ui = {
  loading: signal<string | null>('Starting'),
  cityName: signal('New Haven'),
  dateLabel: signal(''),
  speed: signal<Speed>(1),
  showDev: signal(false),
  showHelp: signal(true),
  devText: signal(''),
  tool: signal<ToolId>('none'),
  roadType: signal<RoadType>(0 as RoadType),
  roadMode: signal<RoadModeId>('straight'),
  hint: signal<Hint | null>(null),
  /** Zone brush: 0 clears zoning, 1-3 are residential, commercial, industrial. */
  zoneType: signal(1),
  zoneDensity: signal(1),
  /** Zone brush: along roads (default) or a rectangle. */
  zoneMode: signal<'road' | 'area'>('road'),
  /** Facility being placed (a FacilityKind). */
  facility: signal(1),
  funds: signal(0),
  population: signal(0),
  /** Demand per zone in -1..1: residential, commercial, industrial. */
  demand: signal<[number, number, number]>([0, 0, 0]),
  /** Projected hourly budget as the city stands now. */
  budget: signal<BudgetReport>(emptyReport()),
  tax: signal<[number, number, number]>([9, 9, 9]),
  loans: signal<Loan[]>([]),
  /** What the bank would offer for each loan size right now, and why not when it would not. */
  loanOffers: signal<LoanOffer[]>([]),
  power: signal<[number, number]>([0, 0]),
  water: signal<[number, number]>([0, 0]),
  alerts: signal<string[]>([]),
  /** The goal being worked on (null when all are done), and a banner for one just reached. */
  goal: signal<{ index: number; total: number; title: string; hint: string; now: number; target: number; reward: number } | null>(null),
  goalBanner: signal<{ title: string; reward: number; next: string | null } | null>(null),
  goalCollapsed: signal(false),
  sandbox: signal(false),
  showBudget: signal(false),
  happiness: signal(0.5),
  /** Time of day as HH:MM, whether it is dark, and how the clock is driven. */
  clock: signal('08:00'),
  /** The current season, which the sky, weather and HUD follow. */
  season: signal<import('../core/constants').SeasonId>('vasant'),
  /** The weather now, for the top bar. */
  weather: signal<{ season: import('../core/constants').SeasonId; name: string; english: string; temperature: number; rain: number; mist: number; effect: string }>({
    season: 'vasant',
    name: 'Spring',
    english: 'Spring',
    temperature: 24,
    rain: 0,
    mist: 0,
    effect: '',
  }),
  isNight: signal(false),
  timeMode: signal<TimeMode>('auto'),
  overlay: signal<OverlayId>('none'),
  showViews: signal(false),
  inspect: signal<InspectData | null>(null),
  council: signal<CouncilView | null>(null),
  /** The live trace of the current (or last) meeting, the last few meetings, and lifetime numbers. */
  trace: signal<CouncilTrace | null>(null),
  traces: signal<CouncilTrace[]>([]),
  aiStats: signal<AiStats>(EMPTY_STATS),
  /** The assistant's recent questions, with what each cost. */
  assistantCalls: signal<import('../game/assistant/controller').AssistantCall[]>([]),
  /** Whether the AI inspector panel is open. */
  inspector: signal(false),
  cinema: signal<CinemaStage>('off'),
  assistant: signal<{ open: boolean; busy: boolean; messages: AssistantMessage[] }>({ open: false, busy: false, messages: [] }),
  quality: signal<import('../render/quality').QualityId>('balanced'),
  /** What a two-finger scroll or mouse wheel does (remembered in this browser). */
  scrollMode: signal<import('../game/input').ScrollMode>(readScrollMode()),
  request: signal<MinisterRequest | null>(null),
  posts: signal<Post[]>([]),
  issues: signal<IssueRow[]>([]),
  showIssues: signal(false),
  showMenu: signal(false),
  saves: signal<SaveMeta[]>([]),
  /** Accounts: whether this build has them, who is signed in, and the cloud slots. */
  account: signal<{ enabled: boolean; email: string | null; busy: boolean; note: string }>({ enabled: false, email: null, busy: false, note: '' }),
  cloudSaves: signal<SaveMeta[]>([]),
  /** A cloud city offered on sign-in ("continue where you left off"). */
  resume: signal<SaveMeta | null>(null),
  muted: signal(false),
  /** Result of the last menu action, shown in the menu. */
  menuNote: signal(''),
};

export interface UiActions {
  convene(issueKey: string): void;
  startCouncil(note: string, lang: Lang, demo: boolean): void;
  approveOption(id: string, withLoan?: boolean): void;
  toggleInspector(): void;
  skipSpeech(): void;
  askAssistant(question: string): void;
  assistantAction(action: AssistantAction): void;
  clearAssistant(): void;
  setQuality(id: import('../render/quality').QualityId): void;
  closeCouncil(): void;
  dismissRequest(): void;
  lookAt(x: number, z: number): void;
  setSpeed(speed: Speed): void;
  selectTool(tool: ToolId): void;
  setRoadType(type: RoadType): void;
  setRoadMode(mode: RoadModeId): void;
  setZone(type: number, density: number): void;
  setZoneMode(mode: 'road' | 'area'): void;
  setFacility(kind: number): void;
  setTax(zone: number, rate: number): void;
  takeLoan(tier: number): void;
  setOverlay(id: OverlayId): void;
  cycleTimeMode(): void;
  newCity(seed: number, sandbox: boolean): void;
  save(slot: string): void;
  load(slot: string): void;
  setMuted(muted: boolean): void;
  refreshSaves(): void;
  signIn(email: string): void;
  signInGoogle(): void;
  signOut(): void;
  cloudSave(slot: string): void;
  cloudLoad(slot: string): void;
  closeInspect(): void;
}

export const actions: UiActions = {
  convene: () => {},
  startCouncil: () => {},
  approveOption: () => {},
  toggleInspector: () => {
    ui.inspector.value = !ui.inspector.value;
  },
  skipSpeech: () => {},
  askAssistant: () => {},
  assistantAction: () => {},
  clearAssistant: () => {},
  setQuality: () => {},
  closeCouncil: () => {},
  dismissRequest: () => {},
  lookAt: () => {},
  setSpeed: () => {},
  selectTool: () => {},
  setRoadType: () => {},
  setRoadMode: () => {},
  setZone: () => {},
  setZoneMode: () => {},
  setFacility: () => {},
  setTax: () => {},
  takeLoan: () => {},
  setOverlay: () => {},
  cycleTimeMode: () => {},
  newCity: () => {},
  save: () => {},
  load: () => {},
  setMuted: () => {},
  refreshSaves: () => {},
  signIn: () => {},
  signInGoogle: () => {},
  signOut: () => {},
  cloudSave: () => {},
  cloudLoad: () => {},
  closeInspect: () => {},
};
