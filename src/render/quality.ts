/**
 * Graphics presets. Laptops without fans (MacBook Air) heat up when the GPU runs flat out,
 * so the default draws fewer frames while nothing on screen needs them and caps the
 * render resolution a little below the screen's.
 */

export type QualityId = 'saver' | 'balanced' | 'high';

export interface Quality {
  id: QualityId;
  label: string;
  /** Highest device pixel ratio the renderer may use. */
  maxDpr: number;
  ao: boolean;
  shadowMap: number;
  /** Frames per second while the player is moving the camera or using a tool. */
  activeFps: number;
  /** Frames per second while the view is still. */
  idleFps: number;
}

export const QUALITY: Record<QualityId, Quality> = {
  saver: { id: 'saver', label: 'Battery saver', maxDpr: 1, ao: false, shadowMap: 2048, activeFps: 30, idleFps: 20 },
  balanced: { id: 'balanced', label: 'Balanced', maxDpr: 1.25, ao: true, shadowMap: 4096, activeFps: 60, idleFps: 30 },
  high: { id: 'high', label: 'High', maxDpr: 1.5, ao: true, shadowMap: 4096, activeFps: 60, idleFps: 60 },
};

const KEY = 'metropolis.quality';

export function loadQuality(): QualityId {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'saver' || v === 'balanced' || v === 'high') return v;
  } catch {
    // Storage blocked: use the default.
  }
  return 'balanced';
}

export function saveQuality(id: QualityId): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Not remembered; fine.
  }
}
