import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';

/**
 * Canvas-drawn textures for the council chamber: wood, wall panelling, carpet, name plates
 * and the city emblem. Generated in code, so no image files or licences are involved.
 */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function finish(c: HTMLCanvasElement, repeat = 1): CanvasTexture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  return t;
}

let seed = 1;
function rnd(): number {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
}

/** Polished wood with long grain. `tone` 0 dark walnut, 1 warm oak. */
export function woodTexture(tone: number, planks = 0): CanvasTexture {
  const [c, g] = canvas(1024, 1024);
  const base = tone > 0.5 ? [124, 78, 44] : [62, 34, 20];
  g.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
  g.fillRect(0, 0, 1024, 1024);
  const rows = planks || 1;
  for (let p = 0; p < rows; p++) {
    const y0 = (p * 1024) / rows;
    const h = 1024 / rows;
    const shade = 0.85 + rnd() * 0.3;
    g.fillStyle = `rgba(${base[0] * shade},${base[1] * shade},${base[2] * shade},0.9)`;
    g.fillRect(0, y0, 1024, h);
    // Grain: long wavy streaks.
    for (let k = 0; k < 90; k++) {
      const y = y0 + rnd() * h;
      const dark = rnd() < 0.5;
      g.strokeStyle = dark ? `rgba(20,10,4,${0.08 + rnd() * 0.18})` : `rgba(255,220,170,${0.04 + rnd() * 0.08})`;
      g.lineWidth = 0.6 + rnd() * 2.2;
      g.beginPath();
      g.moveTo(0, y);
      const amp = 2 + rnd() * 6;
      const f = 0.004 + rnd() * 0.01;
      for (let x = 0; x <= 1024; x += 16) g.lineTo(x, y + Math.sin(x * f + k) * amp);
      g.stroke();
    }
    if (planks) {
      g.fillStyle = 'rgba(10,5,2,0.55)';
      g.fillRect(0, y0, 1024, 2);
      const joint = rnd() * 1024;
      g.fillRect(joint, y0, 2, h);
    }
  }
  return finish(c);
}

/** Raised wall panels for the wainscot. */
export function panelTexture(): CanvasTexture {
  const wood = woodTexture(0.2);
  const img = wood.image as HTMLCanvasElement;
  const [c, g] = canvas(512, 256);
  g.drawImage(img, 0, 0, 512, 256);
  g.strokeStyle = 'rgba(0,0,0,0.45)';
  g.lineWidth = 6;
  g.strokeRect(40, 36, 432, 184);
  g.strokeStyle = 'rgba(255,210,150,0.18)';
  g.lineWidth = 2;
  g.strokeRect(46, 42, 420, 172);
  return finish(c);
}

/** Deep red carpet with a gold border, for under the table. */
export function carpetTexture(): CanvasTexture {
  const [c, g] = canvas(1024, 512);
  g.fillStyle = '#5a1418';
  g.fillRect(0, 0, 1024, 512);
  for (let k = 0; k < 9000; k++) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? '20,0,0' : '140,40,40'},${0.12 + rnd() * 0.12})`;
    g.fillRect(rnd() * 1024, rnd() * 512, 2, 2);
  }
  g.strokeStyle = '#b8903e';
  g.lineWidth = 14;
  g.strokeRect(26, 26, 972, 460);
  g.lineWidth = 3;
  g.strokeRect(48, 48, 928, 416);
  // A medallion pattern in the field.
  g.strokeStyle = 'rgba(184,144,62,0.35)';
  g.lineWidth = 3;
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 3; j++) {
      g.beginPath();
      g.ellipse(130 + i * 152, 140 + j * 116, 36, 22, 0, 0, Math.PI * 2);
      g.stroke();
    }
  }
  const t = finish(c);
  t.wrapS = t.wrapT = 1001; // ClampToEdge
  return t;
}

/** A desk name plate: name over a strip in the ministry colour. */
export function namePlateTexture(name: string, role: string, color: string): CanvasTexture {
  const [c, g] = canvas(512, 128);
  g.fillStyle = '#f3efe6';
  g.fillRect(0, 0, 512, 128);
  g.fillStyle = color;
  g.fillRect(0, 104, 512, 24);
  g.fillStyle = '#1b1d22';
  g.font = '600 46px "Inter Variable", Inter, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(name, 256, 44, 480);
  g.fillStyle = '#55595f';
  g.font = '500 24px "Inter Variable", Inter, system-ui, sans-serif';
  g.fillText(role, 256, 84, 480);
  const t = finish(c);
  t.wrapS = t.wrapT = 1001;
  return t;
}

/** The city emblem behind the chair: a gold seal with the city's name. */
export function emblemTexture(city: string): CanvasTexture {
  const [c, g] = canvas(512, 512);
  g.clearRect(0, 0, 512, 512);
  const grad = g.createRadialGradient(220, 200, 20, 256, 256, 250);
  grad.addColorStop(0, '#f6dc8c');
  grad.addColorStop(1, '#9c7426');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(256, 256, 240, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#16233b';
  g.beginPath();
  g.arc(256, 256, 196, 0, Math.PI * 2);
  g.fill();
  // A skyline in gold.
  g.fillStyle = '#e8c870';
  const bars = [60, 110, 80, 150, 95, 130, 70];
  bars.forEach((h, i) => g.fillRect(150 + i * 31, 300 - h, 24, h));
  g.fillRect(140, 300, 232, 10);
  g.font = '700 38px "Inter Variable", Inter, system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText(city.toUpperCase(), 256, 352, 300);
  g.font = '600 20px "Inter Variable", Inter, system-ui, sans-serif';
  g.fillText('CITY COUNCIL', 256, 384);
  const t = finish(c);
  t.wrapS = t.wrapT = 1001;
  return t;
}
