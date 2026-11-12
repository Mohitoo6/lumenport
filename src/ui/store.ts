import { signal } from '@preact/signals';
import { emptyReport, type BudgetReport, type Loan } from '../sim/economy/budget';
import type { OverlayId } from '../render/overlays/dataOverlay';
import type { RoadType } from '../sim/roads/types';
import type { SaveMeta } from '../sim/save/serialize';
import type { Speed } from '../sim/state';
import type { MinistryId } from '../game/council/ministries';
import type { Lang, Stance } from '../game/council/prompts';
import type { Post } from '../game/council/voices';

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
}

export interface CouncilOptionView {
  id: string;
  title: string;
  cost: number;
  monthly: number;
  facts: string[];
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
  decision?: { option: string; summary: string; dissent: string; conditions: string };
  error?: string;
  /** Where the words come from: 'AI' or 'Demo (no AI)'. */
  source: string;
  /** False when the server has no AI keys: the brief offers a demo meeting instead. */
  aiReady: boolean;
  providers: string[];
  result?: { ok: boolean; text: string };
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

export type ToolId = 'none' | 'road' | 'zone' | 'place' | 'bulldoze';
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
  /** Facility being placed (a FacilityKind). */
  facility: signal(1),
  funds: signal(0),
  population: signal(0),
  /** Demand per zone in -1..1: residential, commercial, industrial. */
  demand: signal<[number, number, number]>([0, 0, 0]),
  /** Projected monthly budget as the city stands now. */
  budget: signal<BudgetReport>(emptyReport()),
  tax: signal<[number, number, number]>([9, 9, 9]),
  loans: signal<Loan[]>([]),
  power: signal<[number, number]>([0, 0]),
  water: signal<[number, number]>([0, 0]),
  alerts: signal<string[]>([]),
  sandbox: signal(false),
  showBudget: signal(false),
  happiness: signal(0.5),
  /** Time of day as HH:MM, whether it is dark, and how the clock is driven. */
  clock: signal('14:30'),
  isNight: signal(false),
  timeMode: signal<TimeMode>('auto'),
  overlay: signal<OverlayId>('none'),
  showViews: signal(false),
  inspect: signal<InspectData | null>(null),
  council: signal<CouncilView | null>(null),
  cinema: signal<CinemaStage>('off'),
  quality: signal<import('../render/quality').QualityId>('balanced'),
  request: signal<MinisterRequest | null>(null),
  posts: signal<Post[]>([]),
  issues: signal<IssueRow[]>([]),
  showIssues: signal(false),
  showMenu: signal(false),
  saves: signal<SaveMeta[]>([]),
  muted: signal(false),
  /** Result of the last menu action, shown in the menu. */
  menuNote: signal(''),
};

export interface UiActions {
  convene(issueKey: string): void;
  startCouncil(note: string, lang: Lang, demo: boolean): void;
  approveOption(id: string): void;
  skipSpeech(): void;
  setQuality(id: import('../render/quality').QualityId): void;
  closeCouncil(): void;
  dismissRequest(): void;
  lookAt(x: number, z: number): void;
  setSpeed(speed: Speed): void;
  selectTool(tool: ToolId): void;
  setRoadType(type: RoadType): void;
  setRoadMode(mode: RoadModeId): void;
  setZone(type: number, density: number): void;
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
  closeInspect(): void;
}

export const actions: UiActions = {
  convene: () => {},
  startCouncil: () => {},
  approveOption: () => {},
  skipSpeech: () => {},
  setQuality: () => {},
  closeCouncil: () => {},
  dismissRequest: () => {},
  lookAt: () => {},
  setSpeed: () => {},
  selectTool: () => {},
  setRoadType: () => {},
  setRoadMode: () => {},
  setZone: () => {},
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
  closeInspect: () => {},
};
