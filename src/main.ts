import '@fontsource-variable/inter';
import './ui/hud.css';
import { Game } from './game/Game';
import { installDebugApi } from './game/debugApi';
import { mountHud } from './ui/Hud';
import { ui } from './ui/store';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('scene') as HTMLCanvasElement;
if (params.has('shots')) document.body.classList.add('shots');
mountHud(document.getElementById('hud')!);

Game.create(canvas, {
  seed: Number(params.get('seed') ?? 1337),
  shots: params.has('shots'),
  council: params.get('council') ?? undefined,
  dev: import.meta.env.DEV || params.has('dev'),
})
  .then(installDebugApi)
  .catch((err: unknown) => {
    console.error(err);
    ui.loading.value = `Could not start: ${err instanceof Error ? err.message : String(err)}`;
  });
