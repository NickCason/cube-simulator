import * as THREE from 'three';
import { MAX_PULSES } from './jellyMaterials.js';
import { FLOOR_PATTERN_GLSL } from './floorpattern.js';

// Studio floor that receives jelly caustics, the jelly's coloured light
// footprint and a soft contact shadow, and fades into the backdrop.
export function createFloor(env, fx) {
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.8, 0.79, 0.77),
    roughness: 0.82,
    metalness: 0,
    envMap: env.texture,
    envMapIntensity: 0.75,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tCaustic = fx.caustic;
    shader.uniforms.tFloorFx = fx.floorFx;
    shader.uniforms.tFloorTint = fx.floorTint;
    shader.uniforms.uFloorRect = fx.floorRect;
    shader.uniforms.uGlowRect = fx.glowRect;
    shader.uniforms.uBg = fx.bg;
    shader.uniforms.uTexel = fx.texel;
    shader.uniforms.uTint = fx.tint;
    shader.uniforms.uCausRect = fx.causRect;
    shader.uniforms.uCausGain = fx.causGain;
    shader.uniforms.uPenumbra = fx.penumbra;
    shader.uniforms.uFxLodBias = fx.fxLodBias;
    shader.uniforms.tRefl = fx.refl;
    shader.uniforms.uRes = fx.res;
    shader.uniforms.uReflAmount = fx.reflAmount;
    shader.uniforms.uReflLod = fx.reflLod;
    shader.uniforms.uGlowFloor = fx.glowFloor;
    shader.uniforms.uTintLocal = fx.tintLocal;
    shader.uniforms.tGlow = fx.glowTex;
    shader.uniforms.uPulseCol = fx.pulseCol;
    shader.uniforms.uPulse = fx.pulse;
    shader.uniforms.uPulseAmp = fx.pulseAmp;
    shader.uniforms.uTime = fx.time;
    shader.uniforms.uSel = fx.sel;
    shader.uniforms.uSelCol = fx.selCol;
    shader.uniforms.uSelPing = fx.selPing;
    shader.uniforms.uPat = fx.pat;
    shader.uniforms.uPatA = fx.patA;
    shader.uniforms.uPatB = fx.patB;
    shader.uniforms.uPatScale = fx.patScale;
    shader.uniforms.uPatGlow = fx.patGlow;
    shader.uniforms.uPatSun = fx.patSun;
    shader.uniforms.tFlour = fx.flour;
    shader.uniforms.uFlourRect = fx.flourRect;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFloorPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvFloorPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vFloorPos;
        uniform sampler2D tCaustic;
        uniform sampler2D tFloorFx;
        uniform sampler2D tFloorTint;
        uniform vec4 uFloorRect;
        uniform vec4 uGlowRect;
        uniform vec3 uBg;
        uniform vec2 uTexel;
        uniform vec3 uTint;
        uniform vec4 uCausRect;
        uniform float uCausGain;
        uniform float uPenumbra;
        uniform float uFxLodBias;
        uniform sampler2D tRefl;
        uniform vec2 uRes;
        uniform float uReflAmount;
        uniform float uReflLod;
        uniform float uGlowFloor;
        uniform float uTintLocal;
        uniform sampler2D tGlow;
        uniform vec3 uPulseCol[${MAX_PULSES}];
        uniform vec4 uPulse[${MAX_PULSES}];
        uniform float uPulseAmp[${MAX_PULSES}];
        uniform float uTime;
        uniform vec4 uSel;
        uniform vec4 uSelCol;
        uniform float uSelPing;
        uniform sampler2D tFlour;
        uniform vec4 uFlourRect;
        float fHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        float fNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(fHash(i), fHash(i + vec2(1.0, 0.0)), f.x), mix(fHash(i + vec2(0.0, 1.0)), fHash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        ${FLOOR_PATTERN_GLSL}
        // a rounded square's signed distance (half side h, corner radius r)
        float sdRoundSq(vec2 p, float h, float r) {
          vec2 q = abs(p) - vec2(h - r);
          return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        // (a place's floor: its pattern)
        vec3 patGlow;
        diffuseColor.rgb = floorPattern(vFloorPos.xz, diffuseColor.rgb, patGlow);
        // flour on it (see Flour): powdery white and matte - as much as
        // there is, that much of the floor under it: thick, all of it; thin,
        // drifts and clumps of it with the floor between
        float flourAmt = 0.0;
        {
          vec2 fl = (vFloorPos.xz - uFlourRect.xy) * uFlourRect.zw;
          if (all(greaterThan(fl, vec2(0.0))) && all(lessThan(fl, vec2(1.0)))) {
            float f = texture2D(tFlour, fl).r * 1.275;
            vec2 q = vFloorPos.xz;
            float n = fNoise(q * 28.0) * 0.5 + fNoise(q * 90.0) * 0.32 + fHash(floor(q * 420.0)) * 0.18;
            flourAmt = smoothstep(n - 0.16, n + 0.16, f * 2.4);
          }
        }
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95, 0.94, 0.91), flourAmt);
        roughnessFactor = mix(roughnessFactor, 1.0, flourAmt);`,
      )
      .replace(
        '#include <lights_fragment_begin>',
        `
        vec2 fuv = (vFloorPos.xz - uFloorRect.xy) * uFloorRect.zw;
        vec3 caus = vec3(0.0);
        float mask = 0.0;
        float contact = 0.0;
        float cover = 0.0;
        vec3 glowNear = vec3(0.0), pool = vec3(0.0);
        // the colour the jelly over here gives the light: its own cube's
        // (several cubes: each shadow its own colour; where two meet, they
        // mix) - and round the shadow, the nearest shadow's (the wide fill)
        vec3 tint = uTint;
        if (all(greaterThan(fuv, vec2(0.0))) && all(lessThan(fuv, vec2(1.0)))) {
          vec4 t0 = textureLod(tFloorTint, fuv, 0.5);
          vec4 t1 = textureLod(tFloorTint, fuv, 3.0);
          vec4 t2 = textureLod(tFloorTint, fuv, 5.0);
          tint = t0.a > 0.02 ? t0.rgb / t0.a : t1.a > 0.002 ? t1.rgb / t1.a : t2.a > 1e-4 ? t2.rgb / t2.a : uTint;
        }
        if (all(greaterThan(fuv, vec2(0.0))) && all(lessThan(fuv, vec2(1.0)))) {
          // The key light's a soft light: its shadow's edge blurs with how
          // far from the floor the jelly casting it is - sharp where the
          // jelly meets the floor, softer up the shadow, softest under a
          // cube in the air. That distance, round about here (the mask's b:
          // see createMaskMaterial), and the edge's width from it.
          vec4 bk = textureLod(tFloorFx, fuv, 3.0 + uFxLodBias);
          float dBlk = bk.r > 1e-3 ? (1.0 - clamp(bk.b / bk.r, 0.0, 1.0)) * 4.0 : 0.0;
          float pen = 0.014 + dBlk * uPenumbra;
          // the shadow: 9 taps a third of that apart, each as wide (by mip level)
          vec2 o2 = uTexel * (pen / 0.0375);
          float lm = max(0.0, log2(pen / 0.0375) + uFxLodBias);
          mask = textureLod(tFloorFx, fuv, lm).r * 0.25
            + (textureLod(tFloorFx, fuv + vec2(o2.x, 0.0), lm).r + textureLod(tFloorFx, fuv - vec2(o2.x, 0.0), lm).r
            + textureLod(tFloorFx, fuv + vec2(0.0, o2.y), lm).r + textureLod(tFloorFx, fuv - vec2(0.0, o2.y), lm).r) * 0.125
            + (textureLod(tFloorFx, fuv + o2, lm).r + textureLod(tFloorFx, fuv - o2, lm).r
            + textureLod(tFloorFx, fuv + vec2(o2.x, -o2.y), lm).r + textureLod(tFloorFx, fuv + vec2(-o2.x, o2.y), lm).r) * 0.0625;
          // ...and the light that came through it (its own texture, fitted
          // round the jelly and blurred a little): crisp, with echoes - a
          // few copies a centimetre or two off, round in two triangles
          // turned to the light, each dimmer - its borders stepped and
          // many-edged, as through a crystal's facets. (Not a square grid:
          // that wove every line inside into a plaid.) Further from the
          // floor the light's softness spreads and blurs them.
          vec2 cuv = (vFloorPos.xz - uCausRect.xy) * uCausRect.zw;
          if (all(greaterThan(cuv, vec2(0.0))) && all(lessThan(cuv, vec2(1.0)))) {
            float sp = max(1.0, pen / 0.03), lc = log2(sp);
            vec2 a0 = dot(uPatSun, uPatSun) > 1e-6 ? normalize(uPatSun) : vec2(1.0, 0.0);
            vec2 a1 = vec2(-0.5 * a0.x - 0.866 * a0.y, 0.866 * a0.x - 0.5 * a0.y);
            vec2 a2 = vec2(-0.5 * a0.x + 0.866 * a0.y, -0.866 * a0.x - 0.5 * a0.y);
            vec2 k1 = vec2(0.012 * sp) * uCausRect.zw, k2 = vec2(-0.022 * sp) * uCausRect.zw;
            caus = textureLod(tCaustic, cuv, lc + 1.0).rgb * 0.3
              + (textureLod(tCaustic, cuv + a0 * k1, lc).rgb + textureLod(tCaustic, cuv + a1 * k1, lc).rgb
              + textureLod(tCaustic, cuv + a2 * k1, lc).rgb) * 0.14
              + (textureLod(tCaustic, cuv + a0 * k2, lc).rgb + textureLod(tCaustic, cuv + a1 * k2, lc).rgb
              + textureLod(tCaustic, cuv + a2 * k2, lc).rgb) * 0.0933;
          }
          vec4 fx0 = textureLod(tFloorFx, fuv, 0.0);
          vec2 o3 = uTexel * 7.0;
          float c0 = fx0.g;
          float c1 = textureLod(tFloorFx, fuv + vec2(o3.x, 0.0), 0.0).g + textureLod(tFloorFx, fuv - vec2(o3.x, 0.0), 0.0).g
            + textureLod(tFloorFx, fuv + vec2(0.0, o3.y), 0.0).g + textureLod(tFloorFx, fuv - vec2(0.0, o3.y), 0.0).g;
          contact = c0 * 0.3 + c1 * 0.175;
          // how much of the sky is seen through jelly from here (wide blur)
          vec2 o4 = uTexel * 16.0;
          float w0 = textureLod(tFloorFx, fuv + vec2(o4.x, 0.0), 0.0).g + textureLod(tFloorFx, fuv - vec2(o4.x, 0.0), 0.0).g
            + textureLod(tFloorFx, fuv + vec2(0.0, o4.y), 0.0).g + textureLod(tFloorFx, fuv - vec2(0.0, o4.y), 0.0).g;
          vec2 o5 = uTexel * 30.0;
          float w1 = textureLod(tFloorFx, fuv + vec2(o5.x, o5.y), 0.0).g + textureLod(tFloorFx, fuv - vec2(o5.x, o5.y), 0.0).g
            + textureLod(tFloorFx, fuv + vec2(-o5.x, o5.y), 0.0).g + textureLod(tFloorFx, fuv + vec2(o5.x, -o5.y), 0.0).g;
          cover = clamp(c0 * 0.35 + c1 * 0.1 + w0 * 0.07 + w1 * 0.045, 0.0, 1.0);
        }
        // (glow mode) the light it casts: each part in its own colour,
        // right under it, then spreading wider and wider
        vec2 guv = (vFloorPos.xz - uGlowRect.xy) * uGlowRect.zw;
        if (uGlowFloor > 0.0 && all(greaterThan(guv, vec2(0.0))) && all(lessThan(guv, vec2(1.0)))) {
          glowNear = textureLod(tGlow, guv, 1.0).rgb;
          pool = textureLod(tGlow, guv, 2.5).rgb * 0.5 + textureLod(tGlow, guv, 4.0).rgb * 0.6
            + textureLod(tGlow, guv, 5.3).rgb * 0.75;
        }
        // ...one colour a cube - or, for layered jelly, the hue of the light
        // that actually came through at this spot (a rainbow on its side
        // shades the floor in bands), at the strength of its tint (the
        // caustics' alpha says where the light came through layers)
        if (uTintLocal > 0.0 && mask > 0.0) {
          vec2 cuv = (vFloorPos.xz - uCausRect.xy) * uCausRect.zw;
          vec4 c3 = textureLod(tCaustic, cuv, 2.9), c5 = textureLod(tCaustic, cuv, 4.4);
          vec3 cb = c3.rgb + c5.rgb * 0.5;
          float cm = max(cb.r, max(cb.g, cb.b));
          float lay = smoothstep(0.05, 0.4, c3.a + c5.a * 0.5);
          vec3 hue = mix(cb / max(cm, 1e-4), vec3(1.0), 0.3) * max(tint.r, max(tint.g, tint.b));
          tint = mix(tint, hue, smoothstep(0.0005, 0.012, cm) * lay);
        }
        // in the jelly's shadow: the light that came through it (coloured,
        // focused), and a little of its colour from light scattered inside
        vec3 jellyTransfer = vec3(1.0 - mask) + caus * uCausGain + tint * mask * 0.22;
        ${THREE.ShaderChunk.lights_fragment_begin.replace(
          'getDirectionalLightInfo( directionalLight, directLight );',
          'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= jellyTransfer;',
        )}`,
      )
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
        // (the sky seen from in its shadow is seen through the jelly too)
        reflectedLight.indirectDiffuse *= mix(vec3(1.0), tint * 1.1, max(cover * 0.8, mask * 0.68)) * (1.0 - contact * 0.35);
        reflectedLight.directDiffuse *= 1.0 - contact * 0.2;`,
      )
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
        // the jelly mirrored in the floor: sharp where it touches, softer
        // further down its reflection; stronger seen at a glancing angle
        {
          vec2 suv = gl_FragCoord.xy / uRes;
          vec4 rf = textureLod(tRefl, suv, uReflLod + 3.0 * (1.0 - textureLod(tRefl, suv, uReflLod).a));
          vec3 Vf = normalize(cameraPosition - vFloorPos);
          float fres = 0.4 + 0.6 * pow(1.0 - max(Vf.y, 0.0), 3.0);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, rf.rgb / max(rf.a, 1e-3), clamp(rf.a * uReflAmount * fres * (1.0 - flourAmt), 0.0, 1.0));
        }
        // glow mode: the jelly lights the floor round it
        if (uGlowFloor > 0.0) {
          // knocks send their ring of light out across the floor too, in the
          // colour of where they hit
          vec3 ring = vec3(0.0);
          for (int i = 0; i < ${MAX_PULSES}; i++) {
            float age = uTime - uPulse[i].w;
            if (age < 0.0 || age > 1.6) continue;
            float d = distance(vFloorPos.xz, uPulse[i].xz);
            float x = (d - age * 2.3) / (0.04 + 0.12 * age);
            ring += uPulseCol[i] * uPulseAmp[i] * exp(-x * x) * exp(-age * 2.6) / (1.0 + d * 1.5);
          }
          gl_FragColor.rgb += uGlowFloor * (glowNear * 0.7 + pool + ring * 2.6);
        }
        // (several cubes) the one the panels edit: a square ring round its
        // foot, turned as it is - a line of its colour on the light floor,
        // a glowing one on the dark - and a ping going out when it's picked
        if (uSelCol.a > 0.0) {
          vec2 p = vFloorPos.xz - uSel.xy;
          float c = cos(uSel.w), s = sin(uSel.w);
          p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
          float d = sdRoundSq(p, uSel.z + 0.075, min(0.12, uSel.z * 0.4));
          float line = exp(-pow(d / 0.014, 2.0)) + exp(-pow(d / 0.05, 2.0)) * 0.25;
          float pa = clamp(1.0 - uSelPing / 0.55, 0.0, 1.0);
          float ping = pa > 0.0 ? exp(-pow((d - uSelPing * 0.55) / 0.022, 2.0)) * pa * pa : 0.0;
          float k = (line + ping * 0.8) * uSelCol.a;
          if (uGlowFloor > 0.0) gl_FragColor.rgb += uSelCol.rgb * k * 1.3;
          else {
            // (its colour as dark as it takes to show on the pale floor - a
            // lemon ring was all but invisible)
            float lum = dot(uSelCol.rgb, vec3(0.2126, 0.7152, 0.0722));
            vec3 rc = min(uSelCol.rgb * (0.28 / max(lum, 0.05)), vec3(1.0));
            gl_FragColor.rgb = mix(gl_FragColor.rgb, rc, clamp(k * 0.8, 0.0, 0.92));
          }
        }
        gl_FragColor.rgb += patGlow * uPatGlow * (1.0 - flourAmt);
        float fdist = length(vFloorPos.xz);
        float fade = smoothstep(3.2, 11.0, fdist);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, uBg, fade);`,
      );
  };
  const geo = new THREE.PlaneGeometry(60, 60, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}
