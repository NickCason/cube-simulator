import * as THREE from 'three';
import { MAX_PULSES } from './jellyMaterials.js';

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
    shader.uniforms.uFloorRect = fx.floorRect;
    shader.uniforms.uBg = fx.bg;
    shader.uniforms.uTexel = fx.texel;
    shader.uniforms.uTint = fx.tint;
    shader.uniforms.uCTexel = fx.ctexel;
    shader.uniforms.tRefl = fx.refl;
    shader.uniforms.uRes = fx.res;
    shader.uniforms.uReflAmount = fx.reflAmount;
    shader.uniforms.uReflLod = fx.reflLod;
    shader.uniforms.uGlowFloor = fx.glowFloor;
    shader.uniforms.tGlow = fx.glowTex;
    shader.uniforms.uPulseCol = fx.pulseCol;
    shader.uniforms.uPulse = fx.pulse;
    shader.uniforms.uPulseAmp = fx.pulseAmp;
    shader.uniforms.uTime = fx.time;
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
        uniform vec4 uFloorRect;
        uniform vec3 uBg;
        uniform vec2 uTexel;
        uniform vec3 uTint;
        uniform vec2 uCTexel;
        uniform sampler2D tRefl;
        uniform vec2 uRes;
        uniform float uReflAmount;
        uniform float uReflLod;
        uniform float uGlowFloor;
        uniform sampler2D tGlow;
        uniform vec3 uPulseCol[${MAX_PULSES}];
        uniform vec4 uPulse[${MAX_PULSES}];
        uniform float uPulseAmp[${MAX_PULSES}];
        uniform float uTime;`,
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
        if (all(greaterThan(fuv, vec2(0.0))) && all(lessThan(fuv, vec2(1.0)))) {
          // soft taps (the key light is an area light: its caustics have a
          // penumbra, and the mesh's facets shouldn't show as lines)
          vec2 o = uCTexel * 3.2, od = uCTexel * 3.6;
          caus = texture2D(tCaustic, fuv).rgb * 0.2
            + (texture2D(tCaustic, fuv + vec2(o.x, 0.0)).rgb + texture2D(tCaustic, fuv - vec2(o.x, 0.0)).rgb
            + texture2D(tCaustic, fuv + vec2(0.0, o.y)).rgb + texture2D(tCaustic, fuv - vec2(0.0, o.y)).rgb) * 0.12
            + (texture2D(tCaustic, fuv + od).rgb + texture2D(tCaustic, fuv - od).rgb
            + texture2D(tCaustic, fuv + vec2(od.x, -od.y)).rgb + texture2D(tCaustic, fuv + vec2(-od.x, od.y)).rgb) * 0.08;
          vec2 o2 = uTexel * 3.0;
          vec4 fx0 = textureLod(tFloorFx, fuv, 0.0);
          vec4 fx1 = textureLod(tFloorFx, fuv + vec2(o2.x, o2.y), 0.0);
          vec4 fx2 = textureLod(tFloorFx, fuv + vec2(-o2.x, o2.y), 0.0);
          vec4 fx3 = textureLod(tFloorFx, fuv + vec2(o2.x, -o2.y), 0.0);
          vec4 fx4 = textureLod(tFloorFx, fuv + vec2(-o2.x, -o2.y), 0.0);
          mask = fx0.r * 0.4 + (fx1.r + fx2.r + fx3.r + fx4.r) * 0.15;
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
          // (glow mode) the light it casts: each part in its own colour,
          // right under it, then spreading wider and wider
          if (uGlowFloor > 0.0) {
            glowNear = textureLod(tGlow, fuv, 1.0).rgb;
            pool = textureLod(tGlow, fuv, 2.5).rgb * 0.5 + textureLod(tGlow, fuv, 4.0).rgb * 0.6
              + textureLod(tGlow, fuv, 5.3).rgb * 0.75;
          }
        }
        // in the jelly's shadow: the light that came through it (coloured,
        // focused), and a little of its colour from light scattered inside
        vec3 jellyTransfer = vec3(1.0 - mask) + caus * 2.7 + uTint * mask * 0.22;
        ${THREE.ShaderChunk.lights_fragment_begin.replace(
          'getDirectionalLightInfo( directionalLight, directLight );',
          'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= jellyTransfer;',
        )}`,
      )
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
        // (the sky seen from in its shadow is seen through the jelly too)
        reflectedLight.indirectDiffuse *= mix(vec3(1.0), uTint * 1.1, max(cover * 0.8, mask * 0.68)) * (1.0 - contact * 0.35);
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
          gl_FragColor.rgb = mix(gl_FragColor.rgb, rf.rgb / max(rf.a, 1e-3), clamp(rf.a * uReflAmount * fres, 0.0, 1.0));
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
