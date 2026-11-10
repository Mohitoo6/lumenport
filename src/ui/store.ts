import { signal } from '@preact/signals';
import type { RoadType } from '../sim/roads/types';
import type { Speed } from '../sim/state';

export type ToolId = 'none' | 'road' | 'bulldoze';
export type RoadModeId = 'straight' | 'curve';

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
};

export interface UiActions {
  setSpeed(speed: Speed): void;
  selectTool(tool: ToolId): void;
  setRoadType(type: RoadType): void;
  setRoadMode(mode: RoadModeId): void;
}

export const actions: UiActions = {
  setSpeed: () => {},
  selectTool: () => {},
  setRoadType: () => {},
  setRoadMode: () => {},
};
