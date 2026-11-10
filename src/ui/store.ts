import { signal } from '@preact/signals';
import type { Speed } from '../sim/state';

/** Reactive values the HUD renders. The game writes them; components only read. */
export const ui = {
  loading: signal<string | null>('Starting'),
  cityName: signal('New Haven'),
  dateLabel: signal(''),
  speed: signal<Speed>(1),
  showDev: signal(false),
  showHelp: signal(true),
  devText: signal(''),
};

export interface UiActions {
  setSpeed(speed: Speed): void;
}

export const actions: UiActions = {
  setSpeed: () => {},
};
