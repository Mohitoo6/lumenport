import { BufferAttribute, BufferGeometry, Color, LineSegments, NormalBlending, ShaderMaterial, Vector3, type Scene } from 'three';

/** Streaks at full intensity. Fewer are drawn in lighter rain. */
const STREAKS = 9000;

/**
 * Rain, drawn as short falling streaks in a box that follows the camera's point of
 * interest. The box and the streaks scale with the viewing distance, so rain reads the
 * same from a street corner as from high above the city. Each streak is two vertices that
 * share a random home position; the vertex shader moves them down and wraps them, so the
 * CPU only updates a handful of uniforms per frame.
 */
export class Rain {
  readonly mesh: LineSegments;
  private readonly material: ShaderMaterial;
  private readonly uniforms = {
    uCenter: { value: new Vector3() },
    uSize: { value: new Vector3(1, 1, 1) },
    uTime: { value: 0 },
    uLength: { value: 1 },
    uAlpha: { value: 0 },
    uColor: { value: new Color(0.72, 0.8, 0.9) },
  };

  constructor(scene: Scene) {
    const home = new Float32Array(STREAKS * 2 * 3);
    const end = new Float32Array(STREAKS * 2);
    for (let i = 0; i < STREAKS; i++) {
      const x = Math.random();
      const y = Math.random();
      const z = Math.random();
      for (let v = 0; v < 2; v++) {
        home[(i * 2 + v) * 3] = x;
        home[(i * 2 + v) * 3 + 1] = y;
        home[(i * 2 + v) * 3 + 2] = z;
        end[i * 2 + v] = v;
      }
    }
    const geometry = new BufferGeometry();
    // `position` is required by three.js but unused: the shader places every vertex.
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(STREAKS * 2 * 3), 3));
    geometry.setAttribute('aHome', new BufferAttribute(home, 3));
    geometry.setAttribute('aEnd', new BufferAttribute(end, 1));
    this.material = new ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        attribute vec3 aHome;
        attribute float aEnd;
        uniform vec3 uCenter;
        uniform vec3 uSize;
        uniform float uTime;
        uniform float uLength;
        varying float vFade;
        void main() {
          // Each streak falls at its own speed and wraps from the bottom of the box to the top.
          float speed = 0.85 + 0.5 * aHome.x;
          float y = fract(aHome.y - uTime * speed);
          vec3 p = vec3(aHome.x - 0.5, y, aHome.z - 0.5) * uSize;
          // Wrap around the point of interest so the box never has to move with it. The
          // cell comes from the streak's head, so both of its ends wrap together.
          vec2 cell = floor((uCenter.xz - p.xz) / uSize.xz + 0.5);
          p.xz += cell * uSize.xz;
          p.y += uCenter.y;
          // The upper vertex trails behind, up and slightly downwind.
          p.y += aEnd * uLength;
          p.x += aEnd * uLength * 0.16;
          // Fade in at the top and out near the ground.
          vFade = smoothstep(1.0, 0.85, y) * smoothstep(0.0, 0.06, y) * (0.35 + 0.65 * (1.0 - aEnd));
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uAlpha;
        varying float vFade;
        void main() {
          gl_FragColor = vec4(uColor, uAlpha * vFade);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
      fog: false,
    });
    this.mesh = new LineSegments(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 900;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /**
   * @param focus the point on the ground the camera looks at
   * @param distance how far the camera is from it, metres
   * @param intensity 0..1
   * @param daylight 0 at night, 1 by day: rain is dimmer in the dark
   */
  update(focus: Vector3, distance: number, intensity: number, daylight: number, dt: number): void {
    const on = intensity > 0.02;
    this.mesh.visible = on;
    if (!on) return;
    const u = this.uniforms;
    const span = Math.max(60, distance * 1.9);
    const height = Math.max(40, distance * 1.1);
    u.uSize.value.set(span, height, span);
    u.uCenter.value.copy(focus);
    // A streak crosses the box in a little over a second, whatever the zoom.
    u.uTime.value = (u.uTime.value + dt * 0.95) % 1000;
    u.uLength.value = height * 0.026;
    u.uAlpha.value = (0.16 + 0.3 * intensity) * (0.35 + 0.65 * daylight);
    this.mesh.geometry.setDrawRange(0, Math.floor(STREAKS * (0.25 + 0.75 * intensity)) * 2);
  }
}
