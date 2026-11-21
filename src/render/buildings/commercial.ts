import {
  ASPHALT,
  CONCRETE,
  CONCRETE_DARK,
  GRAVEL_ROOF,
  IRON_DARK,
  LAWN,
  LINE_WHITE,
  Layer,
  METAL_GREY,
  NO_WIN,
  PAVING,
  SANDSTONE,
  SIGN,
  STEEL_DARK,
  Style,
  WHITE_TRIM,
  awning,
  balcony,
  chhajja,
  flatRoof,
  frontPanel,
  ground,
  indianRooftop,
  mat,
  parking,
  pick,
  roofFinish,
  rooftop,
  shrub,
  vary,
  waterTank,
  win,
  type Lot,
  type Mat,
  type RGB,
} from './common';
import { fitBay } from './geo';

const SHOP_WALLS: ReadonlyArray<[Layer, RGB]> = [
  [Layer.Plaster2, [1.26, 1.2, 1.04]], // warm cream
  [Layer.Plaster2, [1.3, 1.12, 0.82]], // ochre / sandstone pastel
  [Layer.Plaster, [1.3, 1.02, 0.86]], // terracotta peach
  [Layer.Plaster, [0.96, 1.16, 1.24]], // powder blue
  [Layer.Plaster, [0.98, 1.18, 1.02]], // mint
  [Layer.Brick, [1.45, 1.28, 1.18]], // red brick
  [Layer.Brick2, [1.5, 1.4, 1.3]], // buff brick
  [Layer.ConcreteWall, [1.16, 1.15, 1.12]],
];

/** Saturated Indian commercial colours for awnings, fascias and glowing signboards. */
const BRAND: readonly RGB[] = [
  [0.88, 0.14, 0.1], // vermilion red
  [0.08, 0.34, 0.78], // royal blue
  [0.08, 0.54, 0.32], // emerald green
  [0.95, 0.54, 0.06], // saffron orange
  [0.58, 0.14, 0.52], // magenta-purple
  [0.06, 0.5, 0.58], // teal
  [0.92, 0.76, 0.08], // marigold yellow
  [0.18, 0.18, 0.2], // charcoal
];

const SHUTTER_TINTS: readonly RGB[] = [
  [0.95, 1.05, 1.22], // painted steel-blue shutter
  [1.15, 1.16, 1.18], // galvanised grey shutter
  [0.88, 1.06, 0.94], // pale green shutter
  [1.22, 1.14, 0.96], // cream shutter
];

function signBand(l: Lot, x0: number, x1: number, z: number, y0: number, y1: number, tint: RGB): void {
  l.g.box(x0, z, x1, z + 0.22, y0, y1, mat(Layer.Plaster2, tint, 3), SIGN, CONCRETE_DARK);
}

/**
 * Indian bazaar / high-street shops: ground-floor storefronts with metallic rolling
 * shutters, colourful awnings, glowing fascia & projecting blade signboards, and
 * mixed-use flats above with balconies, chhajjas and rooftop water tanks.
 */
function shops(l: Lot): void {
  const { g, r, W, D } = l;
  ground(l, PAVING);
  const z1 = D / 2 - 1.1;
  const z0 = Math.max(-D / 2 + (D > 18 ? 6.8 : 1.0), z1 - r.range(10.5, 13.5));
  const n = Math.max(1, Math.round((W - 0.6) / r.range(5.8, 7.6)));
  const uw = (W - 0.6) / n;
  const gh = 3.85;

  for (let i = 0; i < n; i++) {
    const x0 = -W / 2 + 0.3 + i * uw;
    const x1 = x0 + uw;
    const upper = (l.level >= 2 ? 1 : 0) + (r.chance(0.55) ? 1 : 0);
    const fh = 3.0;
    const top = gh + upper * fh;
    const [wl, wt] = pick(r, SHOP_WALLS);
    const wall = mat(wl, vary(r, wt), wl <= Layer.Brick2 ? 2 : 3);
    const brand = pick(r, BRAND);

    // Shopfront: glazed showroom or metal rolling-shutter bay.
    const shuttered = r.chance(0.28);
    const front = shuttered ? NO_WIN : win(Style.Storefront, fitBay(uw, 3.3), gh, 0.55);
    g.walls(x0, z0, x1, z1, 0, gh, wall, [NO_WIN, NO_WIN, front, NO_WIN]);

    if (shuttered) {
      // Closed or half-open corrugated rolling shutter with side pilasters.
      const shMat = mat(Layer.Metal, pick(r, SHUTTER_TINTS), 0.75);
      const openHalf = r.chance(0.5);
      if (openHalf) {
        frontPanel(g, (x0 + x1) * 0.5, z1, uw - 0.7, 0.04, gh - 1.55, mat(Layer.Concrete, [0.42, 0.44, 0.48], 2), win(Style.Storefront, uw - 0.7, gh - 1.55, 0.65));
        frontPanel(g, (x0 + x1) * 0.5, z1 + 0.04, uw - 0.6, gh - 1.65, gh - 0.9, shMat);
      } else {
        frontPanel(g, (x0 + x1) * 0.5, z1, uw - 0.65, 0.02, gh - 0.95, shMat);
      }
      // Shutter box housing above the opening.
      g.box(x0 + 0.25, z1, x1 - 0.25, z1 + 0.26, gh - 0.98, gh - 0.72, METAL_GREY);
    } else {
      // Raised shop threshold step.
      g.box(x0 + 0.15, z1, x1 - 0.15, z1 + 0.45, 0, 0.18, CONCRETE);
    }

    // Upper mixed-use flats with chhajjas and a projecting balcony.
    if (upper > 0) {
      const wn = win(Style.Punched, fitBay(uw, 2.5), fh, r.range(0.44, 0.54));
      g.walls(x0, z0, x1, z1, gh, top, wall, [wn, NO_WIN, wn, NO_WIN]);
      for (let f = 0; f < upper; f++) {
        chhajja(g, x0 + 0.2, x1 - 0.2, z1, gh + (f + 0.8) * fh, 0.45, WHITE_TRIM, 'front');
      }
      if (uw >= 4.2 && r.chance(0.6)) {
        balcony(g, x0 + 0.45, x1 - 0.45, z1, gh, 0.95, WHITE_TRIM, IRON_DARK, 'parapet-rail', 'front');
      }
    }

    flatRoof(g, x0, z0, x1, z1, top, wall, roofFinish(r), r.range(0.65, 1.05));
    if (upper > 0 && uw >= 5) {
      waterTank(g, (x0 + x1) * 0.5, z0 + 1.5, top, r, 0.82, true);
    } else {
      rooftop(l, x0, z0, x1, z1, top, wall);
    }

    // Glowing signboard fascia + colourful awning + projecting vertical blade sign.
    signBand(l, x0 + 0.22, x1 - 0.22, z1, gh - 0.78, gh - 0.05, brand);
    if (r.chance(0.75)) {
      awning(g, x0 + 0.35, x1 - 0.35, z1 + 0.22, gh - 0.8, 1.45, r.chance(0.6) ? brand : pick(r, BRAND));
    }
    if (upper > 0 && r.chance(0.55)) {
      g.box(x0 + 0.35, z1, x0 + 0.58, z1 + 1.05, gh + 0.5, gh + 2.5, mat(Layer.Plaster2, pick(r, BRAND), 3), SIGN);
    }
  }

  if (z0 - -D / 2 > 5) parking(g, -W / 2 + 0.5, -D / 2 + 0.5, W / 2 - 0.5, z0 - 0.6);
}

/**
 * Indian SCO (Shop-Cum-Office) market complex / shopping plaza: two-storey colonnaded
 * arcade set back behind forecourt parking, individual glowing shop boards, and a pylon.
 */
function stripMall(l: Lot): void {
  const { g, r, W, D } = l;
  ground(l, ASPHALT);
  const depth = Math.min(11.5, D * 0.44);
  const z0 = -D / 2 + 0.8;
  const z1 = z0 + depth;
  const x0 = -W / 2 + 0.8;
  const x1 = W / 2 - 0.8;
  const gh = 4.2;
  const upper = l.level >= 2 || r.chance(0.55);
  const h = upper ? gh + 3.4 : 4.8;
  const [wl, wt] = pick(r, SHOP_WALLS);
  const wall = mat(wl, vary(r, wt), 3);
  const brand = pick(r, BRAND);

  g.walls(x0, z0, x1, z1, 0, gh, wall, [NO_WIN, NO_WIN, win(Style.Storefront, fitBay(x1 - x0, 3.8), gh, 0.55), NO_WIN]);
  if (upper) {
    g.walls(x0, z0, x1, z1, gh, h, wall, [NO_WIN, NO_WIN, win(Style.Ribbon, fitBay(x1 - x0, 3.4), 3.4, 0.52), NO_WIN]);
    chhajja(g, x0 - 0.1, x1 + 0.1, z1, h - 0.25, 0.5, SANDSTONE, 'front');
  }
  flatRoof(g, x0, z0, x1, z1, h, wall, roofFinish(r), 0.95);
  rooftop(l, x0, z0, x1, z1, h, wall);

  // Colonnaded covered walkway arcade in front.
  const arcZ = z1 + 2.6;
  g.flat(x0 - 0.2, z1, x1 + 0.2, arcZ + 0.3, 0.14, PAVING);
  g.box(x0, z1, x1, arcZ, 3.45, 3.8, SANDSTONE, NO_WIN, GRAVEL_ROOF);
  const bays = Math.max(3, Math.round((x1 - x0) / 4.2));
  const bw = (x1 - x0) / bays;
  for (let i = 0; i <= bays; i++) {
    const px = x0 + i * bw;
    g.box(px - 0.16, arcZ - 0.34, px + 0.16, arcZ - 0.02, 0.14, 3.45, WHITE_TRIM);
  }

  // Individual glowing shop fascia boards above the arcade.
  const units = Math.max(2, Math.round((x1 - x0) / 7.2));
  for (let i = 0; i < units; i++) {
    const ux0 = x0 + ((x1 - x0) * i) / units + 0.45;
    const ux1 = x0 + ((x1 - x0) * (i + 1)) / units - 0.45;
    signBand(l, ux0, ux1, arcZ, 3.5, 4.35, i === 0 ? brand : pick(r, BRAND));
  }

  parking(g, -W / 2 + 1.2, arcZ + 0.8, W / 2 - 1.2, D / 2 - 1.4, 0.03);

  // Illuminated plaza pylon sign at the road.
  const sx = (r.chance(0.5) ? -1 : 1) * (W / 2 - 1.6);
  g.box(sx - 0.18, D / 2 - 1.25, sx + 0.18, D / 2 - 0.9, 0, 7.2, STEEL_DARK);
  g.box(sx - 1.35, D / 2 - 1.3, sx + 1.35, D / 2 - 0.85, 4.4, 7.4, mat(Layer.Plaster2, brand, 3), SIGN);
  g.tree(-sx, D / 2 - 1.6, 0.48, r.next() * 6);
}

/** Indian petrol pump: bold branded canopy, dual dispenser islands, office kiosk & price totem. */
function gasStation(l: Lot): void {
  const { g, r, W, D } = l;
  ground(l, mat(Layer.Concrete, [1.18, 1.18, 1.15], 4));
  // Classic Indian oil-company colour pairs (saffron/navy, red/yellow, green/yellow).
  const [brand, accent] = pick(r, [
    [[0.94, 0.45, 0.06], [0.08, 0.28, 0.7]],
    [[0.85, 0.12, 0.1], [0.95, 0.78, 0.08]],
    [[0.08, 0.54, 0.28], [0.95, 0.78, 0.08]],
  ] as ReadonlyArray<[RGB, RGB]>);

  const cw = Math.min(W - 3.6, 13.5);
  const cz = D / 2 - 6.6;
  const canopy = WHITE_TRIM;
  // Two-stripe glowing canopy fascia.
  g.box(-cw / 2, cz - 3.8, cw / 2, cz + 3.8, 4.75, 5.2, mat(Layer.Plaster2, accent, 3), SIGN, null);
  g.box(-cw / 2, cz - 3.8, cw / 2, cz + 3.8, 5.2, 5.7, mat(Layer.Plaster2, brand, 3), SIGN, canopy);

  for (const px of [-cw / 2 + 2.0, cw / 2 - 2.0]) {
    g.box(px - 0.24, cz - 0.24, px + 0.24, cz + 0.24, 0, 4.75, canopy);
    g.box(px - 1.65, cz - 0.6, px + 1.65, cz + 0.6, 0, 0.2, CONCRETE);
    for (const ox of [-0.92, 0.92]) {
      g.box(px + ox - 0.3, cz - 0.32, px + ox + 0.3, cz + 0.32, 0.2, 1.8, WHITE_TRIM, NO_WIN, mat(Layer.Plaster2, brand, 2));
      g.box(px + ox - 0.24, cz + 0.32, px + ox + 0.24, cz + 0.36, 1.05, 1.55, mat(Layer.Plaster2, accent, 2), SIGN);
    }
  }

  // Office & convenience kiosk at the back.
  const kz0 = -D / 2 + 0.8;
  const kz1 = Math.min(kz0 + 5.8, cz - 4.8);
  const kw = Math.min(W - 3.2, 10.4);
  g.walls(-kw / 2, kz0, kw / 2, kz1, 0, 3.6, WHITE_TRIM, [NO_WIN, NO_WIN, win(Style.Storefront, fitBay(kw, 3.2), 3.6, 0.55), NO_WIN]);
  flatRoof(g, -kw / 2, kz0, kw / 2, kz1, 3.6, WHITE_TRIM, roofFinish(r), 0.65);
  signBand(l, -kw / 2 + 0.3, kw / 2 - 0.3, kz1, 2.85, 3.55, brand);

  // Tall glowing price totem at the street.
  const sx = W / 2 - 1.4;
  g.box(sx - 0.72, D / 2 - 1.45, sx + 0.72, D / 2 - 1.05, 0, 6.2, mat(Layer.Plaster2, brand, 3), SIGN);
  g.box(sx - 0.75, D / 2 - 1.48, sx + 0.75, D / 2 - 1.02, 5.4, 6.25, mat(Layer.Plaster2, accent, 3), SIGN);
  g.flat(-W / 2 + 0.3, D / 2 - 0.5, W / 2 - 0.3, D / 2 - 0.38, 0.035, LINE_WHITE);
}

const OFFICE_WALLS: ReadonlyArray<[Layer, RGB]> = [
  [Layer.ConcreteWall, [1.18, 1.16, 1.12]],
  [Layer.Plaster2, [1.24, 1.2, 1.1]],
  [Layer.Plaster, [1.26, 1.12, 0.94]], // warm sandstone
  [Layer.Brick2, [1.48, 1.42, 1.32]],
  [Layer.Plaster, [1.02, 1.12, 1.2]],
  [Layer.Brick, [1.38, 1.24, 1.16]],
];

/**
 * Mid-rise mixed-use commercial block: double-height glazed showrooms with awnings and
 * glowing signboards below, offices or flats above with sun-louvre bands, balconies, and
 * rooftop hoardings.
 */
function midrise(l: Lot): void {
  const { g, r, W, D } = l;
  ground(l, PAVING);
  const gh = 4.4;
  const fh = 3.35;
  const floors = 2 + l.level + r.int(2);
  const top = gh + floors * fh;
  const z1 = D / 2 - 1.0;
  const z0 = -D / 2 + (D > 22 ? 7.2 : 1.4);
  const x0 = -W / 2 + 0.8;
  const x1 = W / 2 - 0.8;
  const [wl, wt] = pick(r, OFFICE_WALLS);
  const wall = mat(wl, vary(r, wt), wl <= Layer.Brick2 ? 2 : 3);
  const brand = pick(r, BRAND);

  const shop = win(Style.Storefront, fitBay(x1 - x0, 4.0), gh, 0.55);
  const sideShop = win(Style.Storefront, fitBay(z1 - z0, 4.0), gh, 0.5);
  g.walls(x0, z0, x1, z1, 0, gh, CONCRETE_DARK, [NO_WIN, sideShop, shop, sideShop]);

  const mixedFlats = r.chance(0.45);
  const style = mixedFlats ? Style.Punched : Style.Ribbon;
  const wf = win(style, fitBay(x1 - x0, style === Style.Ribbon ? 3.4 : 2.7), fh, r.range(0.5, 0.62));
  const ws = win(style, fitBay(z1 - z0, style === Style.Ribbon ? 3.4 : 2.7), fh, 0.5);
  g.walls(x0, z0, x1, z1, gh, top, wall, [wf, ws, wf, ws]);

  // String course above showrooms, architectural vertical fins, and chhajja ledges.
  g.box(x0 - 0.14, z1, x1 + 0.14, z1 + 0.25, gh - 0.12, gh + 0.26, SANDSTONE);
  g.box(x0 - 0.18, z1, x1 + 0.18, z1 + 0.34, top - 0.12, top + 0.32, SANDSTONE);

  if (mixedFlats) {
    // Mixed-use flats above shops: balconies and chhajjas.
    for (let f = 0; f < floors; f++) {
      const y = gh + f * fh;
      chhajja(g, x0 + 0.1, x1 - 0.1, z1, y + 0.8 * fh, 0.45, WHITE_TRIM, 'front');
      if (x1 - x0 >= 10 && f % 2 === 0) {
        balcony(g, x0 + 0.6, x0 + (x1 - x0) * 0.38, z1, y, 1.0, WHITE_TRIM, IRON_DARK, 'parapet-rail', 'front');
        balcony(g, x1 - (x1 - x0) * 0.38, x1 - 0.6, z1, y, 1.0, WHITE_TRIM, IRON_DARK, 'parapet-rail', 'front');
      }
    }
  } else {
    // Office vertical sun-shading fins along the front facade.
    const fins = Math.max(2, Math.round((x1 - x0) / 4.2));
    for (let i = 1; i < fins; i++) {
      const fx = x0 + ((x1 - x0) * i) / fins;
      g.box(fx - 0.12, z1, fx + 0.12, z1 + 0.42, gh + 0.26, top + 0.32, WHITE_TRIM);
    }
  }

  flatRoof(g, x0, z0, x1, z1, top, wall, roofFinish(r), 0.95);
  if (mixedFlats) indianRooftop(l, x0, z0, x1, z1, top, wall, WHITE_TRIM, 2);
  else rooftop(l, x0, z0, x1, z1, top, wall);

  const units = Math.max(1, Math.round((x1 - x0) / 8.5));
  for (let i = 0; i < units; i++) {
    const ux0 = x0 + ((x1 - x0) * i) / units + 0.4;
    const ux1 = x0 + ((x1 - x0) * (i + 1)) / units - 0.4;
    const c = i === 0 ? brand : pick(r, BRAND);
    signBand(l, ux0, ux1, z1, gh - 0.95, gh - 0.18, c);
    if (r.chance(0.55)) awning(g, ux0, ux1, z1 + 0.22, gh - 0.98, 1.35, c);
  }

  // Rooftop illuminated hoarding / billboard on some commercial blocks.
  if (r.chance(0.38)) {
    const bw = Math.min(9.5, (x1 - x0) * 0.62);
    for (const px of [-bw / 2 + 0.6, bw / 2 - 0.6]) g.box(px - 0.12, z1 - 1.6, px + 0.12, z1 - 1.38, top, top + 4.8, STEEL_DARK);
    g.box(-bw / 2, z1 - 1.75, bw / 2, z1 - 1.48, top + 1.6, top + 4.9, mat(Layer.Plaster2, pick(r, BRAND), 3), SIGN);
  }
  if (z0 - -D / 2 > 5.5) parking(g, -W / 2 + 0.5, -D / 2 + 0.5, W / 2 - 0.5, z0 - 0.6);
}

/** Glass colours for curtain walls: cool blue, emerald, silver, bronze, deep navy. */
const GLASS: readonly RGB[] = [
  [0.34, 0.54, 0.72],
  [0.28, 0.52, 0.5],
  [0.48, 0.58, 0.66],
  [0.58, 0.48, 0.36],
  [0.26, 0.36, 0.52],
  [0.38, 0.58, 0.54],
  [0.52, 0.56, 0.6],
];

/**
 * Corporate glass office tower: grand double-height stone & glass podium with portico,
 * stepped curtain-wall shaft with vertical architectural fins & refuge bands, and a
 * sculpted illuminated crown.
 */
function officeTower(l: Lot): void {
  const { g, r, W, D } = l;
  ground(l, PAVING);
  const fh = 3.8;
  const total = 10 + l.level * 6 + r.int(5);
  const glass = pick(r, GLASS);
  const curtain = mat(Layer.ConcreteWall, glass, 3);
  const frame: Mat = r.chance(0.5) ? mat(Layer.ConcreteWall, [1.24, 1.24, 1.2], 3) : mat(Layer.Metal, [0.55, 0.58, 0.62], 3);
  const stone = mat(Layer.ConcreteWall, vary(r, [1.14, 1.1, 1.04]), 3);
  const brand = pick(r, BRAND);

  let x0 = -W / 2 + 1.4;
  let x1 = W / 2 - 1.4;
  let z1 = D / 2 - 2.6;
  let z0 = -D / 2 + 1.6;

  // Podium: two tall retail/lobby floors with green terrace roof and grand entrance portico.
  const ph = 8.4;
  const pw = win(Style.Storefront, fitBay(x1 - x0, 4.4), ph / 2, 0.55);
  const pd = win(Style.Storefront, fitBay(z1 - z0, 4.4), ph / 2, 0.5);
  g.walls(x0, z0, x1, z1, 0, ph, stone, [pd, pd, pw, pd]);
  flatRoof(g, x0, z0, x1, z1, ph, stone, r.chance(0.5) ? LAWN : PAVING, 1.05);
  // Cantilevered glass-and-steel entrance portico with steps.
  g.box(-3.6, z1, 3.6, z1 + 2.4, 4.4, 4.85, frame);
  for (const px of [-3.2, 3.2]) g.box(px - 0.16, z1 + 2.0, px + 0.16, z1 + 2.32, 0, 4.4, frame);
  g.stair(-3.0, z1, 3.0, z1 + 1.1, 0, 0.45, 3, CONCRETE);

  // Stepped curtain-wall shaft in 2-3 tiers.
  const tiers = 1 + (total > 16 ? 1 : 0) + (total > 24 && r.chance(0.65) ? 1 : 0);
  let y = ph;
  let left = total;
  const cornerPiers = r.chance(0.55);
  const verticalFins = r.chance(0.6);

  for (let t = 0; t < tiers; t++) {
    const inset = t === 0 ? r.range(1.2, 2.2) : r.range(1.4, 2.4);
    x0 += inset;
    x1 -= inset;
    z0 += inset * 0.9;
    z1 -= inset * 0.9;
    if (x1 - x0 < 8 || z1 - z0 < 8) break;
    const n = t === tiers - 1 ? left : Math.max(4, Math.round(left * r.range(0.48, 0.62)));
    left -= n;
    const top = y + n * fh;
    const wf = win(Style.Curtain, fitBay(x1 - x0, 1.85), fh, 0.55);
    const ws = win(Style.Curtain, fitBay(z1 - z0, 1.85), fh, 0.52);
    g.walls(x0, z0, x1, z1, y, top, curtain, [wf, ws, wf, ws]);

    if (cornerPiers) {
      for (const [cx, cz] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]] as const) {
        g.box(cx - 0.48, cz - 0.48, cx + 0.48, cz + 0.48, y, top + 0.7, frame);
      }
    }
    if (verticalFins && t === 0) {
      const fins = Math.max(2, Math.round((x1 - x0) / 5.2));
      for (let i = 1; i < fins; i++) {
        const fx = x0 + ((x1 - x0) * i) / fins;
        g.box(fx - 0.14, z1, fx + 0.14, z1 + 0.45, y, top + 0.5, frame);
      }
    }
    // Refuge / mechanical accent belt on tall lower tiers.
    if (n >= 10) {
      const midY = y + Math.floor(n * 0.5) * fh;
      g.box(x0 - 0.15, z0 - 0.15, x1 + 0.15, z1 + 0.15, midY - 0.2, midY + 0.2, frame);
    }
    flatRoof(g, x0, z0, x1, z1, top, frame, roofFinish(r), 1.15);
    y = top;
  }

  // Sculpted corporate crown: glazed/framed plant box, dramatic twin fins or angled fin, and lit logo.
  const cx = (x0 + x1) * 0.5;
  const cz = (z0 + z1) * 0.5;
  const cw = (x1 - x0) * 0.6;
  const cd = (z1 - z0) * 0.58;
  g.box(cx - cw / 2, cz - cd / 2, cx + cw / 2, cz + cd / 2, y, y + 4.4, frame, NO_WIN, GRAVEL_ROOF);
  rooftop(l, x0, z0, x1, z1, y, frame);

  const crownStyle = r.int(3);
  if (crownStyle === 0) {
    // Sweeping vertical crown fins + illuminated strip.
    g.box(x0 + 0.3, z1 - 0.4, x1 - 0.3, z1 + 0.1, y, y + 4.8, frame);
    g.box(x0 + 0.6, z1 + 0.1, x1 - 0.6, z1 + 0.28, y + 3.2, y + 4.3, mat(Layer.Plaster2, brand, 3), SIGN);
    g.cyl(cx, cz, 0.22, 0.05, y + 4.4, y + 4.4 + r.range(8, 15), 6, METAL_GREY);
  } else if (crownStyle === 1) {
    // Diagonal slanted architectural sail fin.
    g.poly(
      [
        [x0, y, z1],
        [x1, y, z1],
        [x1, y + 6.8, z1],
        [x0, y + 1.6, z1],
      ],
      frame,
      NO_WIN,
      false,
    );
    g.poly(
      [
        [x1, y, z1 - 0.45],
        [x0, y, z1 - 0.45],
        [x0, y + 1.6, z1 - 0.45],
        [x1, y + 6.8, z1 - 0.45],
      ],
      frame,
      NO_WIN,
      false,
    );
    g.poly(
      [
        [x0, y + 1.6, z1],
        [x1, y + 6.8, z1],
        [x1, y + 6.8, z1 - 0.45],
        [x0, y + 1.6, z1 - 0.45],
      ],
      frame,
    );
    g.box(cx - cw * 0.42, cz + cd / 2, cx + cw * 0.42, cz + cd / 2 + 0.22, y + 1.4, y + 3.6, mat(Layer.Plaster2, brand, 3), SIGN);
  } else {
    // Illuminated penthouse frame + twin spire masts.
    g.box(cx - cw / 2 + 0.3, cz + cd / 2, cx + cw / 2 - 0.3, cz + cd / 2 + 0.22, y + 1.3, y + 3.7, mat(Layer.Plaster2, brand, 3), SIGN);
    g.cyl(cx - 1.2, cz, 0.16, 0.04, y + 4.4, y + 15, 6, METAL_GREY);
    g.cyl(cx + 1.2, cz, 0.16, 0.04, y + 4.4, y + 12, 6, METAL_GREY);
  }

  // Plaza: raised planters, trees, and shrubs along the street.
  for (const sx of [-W / 2 + 2.2, W / 2 - 2.2]) {
    g.box(sx - 1.1, D / 2 - 2.2, sx + 1.1, D / 2 - 0.5, 0, 0.48, CONCRETE, NO_WIN, LAWN);
    g.tree(sx, D / 2 - 1.35, 0.52, r.next() * 6);
  }
  shrub(g, -4.4, D / 2 - 1.2, 0.52);
  shrub(g, 4.4, D / 2 - 1.2, 0.52);
}

export function commercial(l: Lot): void {
  const { r, W, D } = l;
  if (l.density === 1) {
    if (W >= 16 && D >= 16 && r.chance(0.06)) gasStation(l);
    else if (W >= 24 && D >= 16 && r.chance(0.5)) stripMall(l);
    else shops(l);
  } else if (l.density === 2) {
    if (W < 12 || D < 14) shops(l);
    else midrise(l);
  } else if (W < 20 || D < 20) midrise(l);
  else officeTower(l);
}

