import * as THREE from 'three';

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
        uniform vec3 uTint;`,
      )
      .replace(
        '#include <lights_fragment_begin>',
        `
        vec2 fuv = (vFloorPos.xz - uFloorRect.xy) * uFloorRect.zw;
        vec3 caus = vec3(0.0);
        float mask = 0.0;
        float contact = 0.0;
        float cover = 0.0;
        if (all(greaterThan(fuv, vec2(0.0))) && all(lessThan(fuv, vec2(1.0)))) {
          // soft taps (area light penumbra)
          vec2 o = uTexel * 1.6;
          caus = texture2D(tCaustic, fuv).rgb * 0.36
            + (texture2D(tCaustic, fuv + vec2(o.x, 0.0)).rgb + texture2D(tCaustic, fuv - vec2(o.x, 0.0)).rgb
            + texture2D(tCaustic, fuv + vec2(0.0, o.y)).rgb + texture2D(tCaustic, fuv - vec2(0.0, o.y)).rgb) * 0.16;
          vec2 o2 = uTexel * 3.0;
          vec4 fx0 = texture2D(tFloorFx, fuv);
          vec4 fx1 = texture2D(tFloorFx, fuv + vec2(o2.x, o2.y));
          vec4 fx2 = texture2D(tFloorFx, fuv + vec2(-o2.x, o2.y));
          vec4 fx3 = texture2D(tFloorFx, fuv + vec2(o2.x, -o2.y));
          vec4 fx4 = texture2D(tFloorFx, fuv + vec2(-o2.x, -o2.y));
          mask = fx0.r * 0.4 + (fx1.r + fx2.r + fx3.r + fx4.r) * 0.15;
          vec2 o3 = uTexel * 7.0;
          float c0 = fx0.g;
          float c1 = texture2D(tFloorFx, fuv + vec2(o3.x, 0.0)).g + texture2D(tFloorFx, fuv - vec2(o3.x, 0.0)).g
            + texture2D(tFloorFx, fuv + vec2(0.0, o3.y)).g + texture2D(tFloorFx, fuv - vec2(0.0, o3.y)).g;
          contact = c0 * 0.3 + c1 * 0.175;
          // how much of the sky is seen through jelly from here (wide blur)
          vec2 o4 = uTexel * 16.0;
          float w0 = texture2D(tFloorFx, fuv + vec2(o4.x, 0.0)).g + texture2D(tFloorFx, fuv - vec2(o4.x, 0.0)).g
            + texture2D(tFloorFx, fuv + vec2(0.0, o4.y)).g + texture2D(tFloorFx, fuv - vec2(0.0, o4.y)).g;
          vec2 o5 = uTexel * 30.0;
          float w1 = texture2D(tFloorFx, fuv + vec2(o5.x, o5.y)).g + texture2D(tFloorFx, fuv - vec2(o5.x, o5.y)).g
            + texture2D(tFloorFx, fuv + vec2(-o5.x, o5.y)).g + texture2D(tFloorFx, fuv + vec2(o5.x, -o5.y)).g;
          cover = clamp(c0 * 0.35 + c1 * 0.1 + w0 * 0.07 + w1 * 0.045, 0.0, 1.0);
        }
        vec3 jellyTransfer = vec3(1.0 - mask) + caus + uTint * mask * 0.28;
        ${THREE.ShaderChunk.lights_fragment_begin.replace(
          'getDirectionalLightInfo( directionalLight, directLight );',
          'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= jellyTransfer;',
        )}`,
      )
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
        reflectedLight.indirectDiffuse *= mix(vec3(1.0), uTint * 1.1, cover * 0.8) * (1.0 - contact * 0.35);
        reflectedLight.directDiffuse *= 1.0 - contact * 0.2;`,
      )
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
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
