/**
 * ShowAt Docs — linked-particle field, exact-clone backend (WebGPU/TSL).
 *
 * Faithful port of the simulation from webgpu-tsl-linkedparticles by
 * Christophe Choffel (https://github.com/ULuIQ12/webgpu-tsl-linkedparticles,
 * MIT License, Copyright (c) 2024 Christophe Choffel — full notice below),
 * retuned for a documentation background:
 * - particles spawn at the cursor AND at a slow ambient wander point
 *   (so touch devices and idle pages stay alive)
 * - palette locked to purple + white (no hue cycling, no green)
 * - fixed camera with a slow orbit instead of drag controls
 *   (dragging would fight page scroll; the canvas is pointer-transparent)
 * - no GUI panel
 * Everything else — turbulence motion, two-nearest link quads, hexagon
 * sprites, lifetime pulse, hex backdrop, edge blur, bloom, RGB shift —
 * follows the reference implementation.
 *
 * ---
 * MIT License
 * Copyright (c) 2024 Christophe Choffel
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included
 * in all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
 * OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
 */

import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  Clock,
  DoubleSide,
  Float32BufferAttribute,
  IcosahedronGeometry,
  If,
  InstancedMesh,
  Mesh,
  MeshBasicNodeMaterial,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Raycaster,
  Scene,
  SpriteNodeMaterial,
  StorageBufferAttribute,
  StorageInstancedBufferAttribute,
  Vector2,
  Vector3,
  WebGPURenderer,
  abs,
  acos,
  atan2,
  bloom,
  clamp,
  color,
  cos,
  dot,
  float,
  floor,
  fract,
  instanceIndex,
  length,
  loop,
  max,
  min,
  mod,
  mul,
  mx_fractal_noise_float,
  mx_fractal_noise_vec3,
  pass,
  pcurve,
  PI,
  PI2,
  positionWorld,
  PostProcessing,
  rgbShift,
  sign,
  sin,
  smoothstep,
  storage,
  step,
  sub,
  timerDelta,
  timerGlobal,
  tslFn,
  uniform,
  uv,
  varying,
  vec2,
  vec3,
  viewportTopLeft,
} from "./three.webgpu.min.js";

const PURPLE = 0x7c3aed;
const OFF_WHITE = 0xd9d9e3;

/** Transpiled shape utilities, from the reference (Inigo Quilez inspired). */
const cubicPulse = tslFn(([c, w, x]) => {
  const xx = float(x).toVar();
  const ww = float(w).toVar();
  const cc = float(c).toVar();
  xx.assign(abs(xx.sub(cc)));
  If(xx.greaterThan(ww), () => {
    return 0.0;
  });
  xx.divAssign(ww);
  return sub(1.0, xx.mul(xx).mul(sub(3.0, mul(2.0, xx))));
});

const sdHexagon = tslFn(([p, r]) => {
  const rr = float(r).toVar();
  const pp = vec2(p).toVar();
  const k = vec3(-0.866025404, 0.5, 0.577350269);
  pp.assign(abs(pp));
  pp.subAssign(mul(2.0, min(dot(k.xy, pp), 0.0).mul(k.xy)));
  pp.subAssign(vec2(clamp(pp.x, k.z.negate().mul(rr), k.z.mul(rr)), rr));
  return length(pp).mul(sign(pp.y));
});

const hexagonPattern = tslFn(([p]) => {
  const pp = vec2(p).toVar();
  const q = vec2(pp.x.mul(2.0).mul(0.577350269), pp.y.add(pp.x.mul(0.577350269))).toVar();
  const pi = vec2(floor(q)).toVar();
  const pf = vec2(fract(q)).toVar();
  const v = float(mod(pi.x.add(pi.y), 3.0)).toVar();
  const ca = float(step(1.0, v)).toVar();
  const cb = float(step(2.0, v)).toVar();
  const ma = vec2(step(pf.xy, pf.yx)).toVar();
  const e = float(dot(ma, sub(1.0, pf.yx).add(ca.mul(pf.x.add(pf.y.sub(1.0)))).add(cb.mul(pf.yx.sub(mul(2.0, pf.xy)))))).toVar();
  return vec3(pi.add(ca).sub(cb.mul(ma)), e);
});

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} opts
 * @param {number} opts.count particle count (already tiered by caller)
 * @param {number} opts.spawnNb cursor spawns per frame
 * @param {boolean} opts.reduceMotion render settled frames, no loop
 * @param {number} opts.maxDpr pixel-ratio cap
 */
export async function startLinkedField(canvas, opts) {
  const { count: nbParticles, spawnNb, reduceMotion, maxDpr } = opts;

  const renderer = new WebGPURenderer({ canvas, antialias: true, powerPreference: "low-power" });
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr || 1.5));

  const layout = () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  layout();

  const scene = new Scene();
  const camera = new PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 1000);
  camera.position.set(0, 3, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();

  const clock = new Clock(false);
  const uTimeScale = uniform(1.0);
  const uParticleSize = uniform(1.0);
  const uParticleLifetime = uniform(1.4);
  const uLinksWidth = uniform(0.005);
  const uColorVariance = uniform(1.4);
  const uBounds = uniform(new Vector2(10, 7));
  const turbFrequency = uniform(0.5);
  const turbAmplitude = uniform(0.5);
  const turbOctaves = uniform(2);
  const turbLacunarity = uniform(2.0);
  const turbGain = uniform(0.5);
  const turbFriction = uniform(0.01);
  const uCamFadeThreshold = uniform(9.0);
  const uSpawnIndex = uniform(0);
  const uSpawnIndexAmb = uniform(0);
  const uSpawnPosition = uniform(new Vector3(0, 0, 0));
  const uSpawnPositionBefore = uniform(new Vector3(0, 0, 0));
  const uSpawnAmb = uniform(new Vector3(0, 0, 0));
  const uSpawnAmbBefore = uniform(new Vector3(0, 0, 0));

  const syncBounds = () => {
    const halfH = Math.tan((70 * Math.PI) / 360) * 10;
    uBounds.value.set(halfH * camera.aspect, halfH);
  };
  syncBounds();

  // Purple <-> white per-particle color. Fixed: no hue rotation.
  const getInstanceColor = tslFn(([i]) => {
    const n = mx_fractal_noise_float(i.toFloat().mul(0.1), 2, 2.0, 0.5, uColorVariance).add(0.5);
    return mix(color(OFF_WHITE), color(PURPLE), n);
  });

  // ---- particle state ----
  const partPositions = storage(new StorageInstancedBufferAttribute(nbParticles, 4), "vec4", nbParticles);
  const partVelocities = storage(new StorageInstancedBufferAttribute(nbParticles, 4), "vec4", nbParticles);

  const partMat = new SpriteNodeMaterial();
  partMat.transparent = true;
  partMat.blending = AdditiveBlending;
  partMat.depthWrite = false;
  partMat.positionNode = partPositions.toAttribute();
  partMat.scaleNode = vec2(uParticleSize);
  partMat.rotationNode = atan2(partVelocities.toAttribute().y, partVelocities.toAttribute().x);
  partMat.colorNode = tslFn(() => {
    const life = partPositions.toAttribute().w;
    const modLife = pcurve(life.oneMinus(), 8.0, 1.0);
    const col = getInstanceColor(instanceIndex);
    const pulse = pcurve(sin(timerGlobal(5.0).add(instanceIndex.toFloat().mul(0.1))).mul(0.5).add(0.5), 0.5, 0.5).mul(6.0).add(0.8);
    return col.mul(pulse).mul(modLife);
  })();
  partMat.opacityNode = tslFn(() => {
    const hex = sdHexagon(uv().xy.sub(0.5), 0.5);
    const life = partPositions.toAttribute().w;
    const camDist = partPositions.toAttribute().xyz.sub(cameraPosition.xyz).lengthSq();
    const camFac = float(1.0).toVar();
    If(camDist.lessThan(uCamFadeThreshold), () => {
      camFac.assign(camDist.div(uCamFadeThreshold).pow(3.0));
    });
    return max(0.0, step(0.0, hex).oneMinus().mul(life)).mul(camFac);
  })();

  const partMesh = new InstancedMesh(new PlaneGeometry(0.05, 0.05), partMat, nbParticles);
  partMesh.frustumCulled = false;
  scene.add(partMesh);

  // ---- link quads: two per particle, fixed index ----
  const indices = [];
  for (let i = 0; i < nbParticles; i++) {
    const i0 = i * 8;
    indices.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
    indices.push(i0 + 4, i0 + 5, i0 + 6, i0 + 4, i0 + 6, i0 + 7);
  }
  const nbVerts = nbParticles * 8;
  const vertSBA = new StorageBufferAttribute(nbVerts, 4);
  const colorsSBA = new StorageBufferAttribute(nbVerts, 3);
  const linkGeom = new BufferGeometry();
  linkGeom.setAttribute("position", vertSBA);
  linkGeom.setAttribute("color", colorsSBA);
  linkGeom.setAttribute("normal", new Float32BufferAttribute(new Float32Array(nbVerts * 3).fill(0), 3));
  linkGeom.setIndex(indices);

  const linkMat = new MeshBasicNodeMaterial();
  linkMat.vertexColors = true;
  linkMat.transparent = true;
  linkMat.side = DoubleSide;
  linkMat.depthWrite = false;
  linkMat.depthTest = false;
  linkMat.blending = AdditiveBlending;
  linkMat.colorNode = color(0xffffff);
  linkMat.opacityNode = tslFn(() => {
    const part = storage(vertSBA, "vec4", vertSBA.count).toAttribute();
    const o = part.w;
    const p = part.xyz;
    const camFac = float(1.0).toVar();
    const camDist = p.sub(varying(cameraPosition).xyz).lengthSq();
    If(camDist.lessThan(uCamFadeThreshold), () => {
      camFac.assign(camDist.div(uCamFadeThreshold).pow(3.0));
    });
    return o.mul(camFac);
  })();

  const linkMesh = new Mesh(linkGeom, linkMat);
  linkMesh.frustumCulled = false;
  scene.add(linkMesh);

  // ---- init: scatter with staggered lifetimes so frame one is alive ----
  const initKernel = tslFn(() => {
    const h1 = instanceIndex.hash();
    const h2 = instanceIndex.add(7).hash();
    const h3 = instanceIndex.add(13).hash();
    const h4 = instanceIndex.add(29).hash();
    partPositions.element(instanceIndex).xyz.assign(
      vec3(h1.sub(0.5).mul(2.0).mul(uBounds.x), h2.sub(0.5).mul(2.0).mul(uBounds.y), h3.sub(0.5).mul(5.0))
    );
    partPositions.element(instanceIndex).w.assign(h4);
    partVelocities.element(instanceIndex).xyz.assign(vec3(0.0));
  })().compute(nbParticles);

  // ---- motion + two-nearest link quads (reference kernel) ----
  const motionKernel = tslFn(() => {
    const position = partPositions.element(instanceIndex).xyz;
    const velocity = partVelocities.element(instanceIndex).xyz;
    const life = partPositions.element(instanceIndex).w;
    const dt = timerDelta(0.1).mul(uTimeScale);

    If(life.greaterThan(0.0), () => {
      const vel = mx_fractal_noise_vec3(position.mul(turbFrequency), turbOctaves, turbLacunarity, turbGain, turbAmplitude).mul(life.add(0.01));
      velocity.addAssign(vel);
      velocity.mulAssign(turbFriction.oneMinus());
      position.assign(position.add(velocity.mul(dt)));
      life.subAssign(dt.mul(float(1.0).div(uParticleLifetime)));

      const closestDist1 = float(10000.0).toVar();
      const closestPos1 = vec3(0.0).toVar();
      const closestLife1 = float(0.0).toVar();
      const closestDist2 = float(10000.0).toVar();
      const closestPos2 = vec3(0.0).toVar();
      const closestLife2 = float(0.0).toVar();

      loop({ type: "uint", start: 0, end: nbParticles, condition: "<" }, ({ i }) => {
        const otherPart = partPositions.element(i);
        If(i.notEqual(instanceIndex).and(otherPart.w.greaterThan(0.0)), () => {
          const otherPosition = otherPart.xyz;
          const dist = position.sub(otherPosition).lengthSq();
          const moreThanZero = dist.greaterThan(0.0);
          If(dist.lessThan(closestDist1).and(moreThanZero), () => {
            closestDist1.assign(dist);
            closestPos1.assign(otherPosition.xyz);
            closestLife1.assign(otherPart.w);
          }).elseif(dist.lessThan(closestDist2).and(moreThanZero), () => {
            closestDist2.assign(dist);
            closestPos2.assign(otherPosition.xyz);
            closestLife2.assign(otherPart.w);
          });
        });
      });

      const lPositions = storage(vertSBA, "vec4", vertSBA.count);
      const lColors = storage(colorsSBA, "vec4", colorsSBA.count);
      const lIndex1 = instanceIndex.mul(8);
      const lIndex2 = lIndex1.add(4);
      const lw = uLinksWidth;

      lPositions.element(lIndex1).xyz.assign(position);
      lPositions.element(lIndex1).y.addAssign(lw);
      lPositions.element(lIndex1.add(1)).xyz.assign(position);
      lPositions.element(lIndex1.add(1)).y.addAssign(lw.negate());
      lPositions.element(lIndex1.add(2)).xyz.assign(closestPos1);
      lPositions.element(lIndex1.add(2)).y.addAssign(lw.negate());
      lPositions.element(lIndex1.add(3)).xyz.assign(closestPos1);
      lPositions.element(lIndex1.add(3)).y.addAssign(lw);

      lPositions.element(lIndex2).xyz.assign(position);
      lPositions.element(lIndex2).y.addAssign(lw);
      lPositions.element(lIndex2.add(1)).xyz.assign(position);
      lPositions.element(lIndex2.add(1)).y.addAssign(lw.negate());
      lPositions.element(lIndex2.add(2)).xyz.assign(closestPos2);
      lPositions.element(lIndex2.add(2)).y.addAssign(lw.negate());
      lPositions.element(lIndex2.add(3)).xyz.assign(closestPos2);
      lPositions.element(lIndex2.add(3)).y.addAssign(lw);

      const col = getInstanceColor(instanceIndex);
      const l1 = max(0.0, min(closestLife1, life)).pow(0.8);
      const l2 = max(0.0, min(closestLife2, life)).pow(0.8);
      loop({ type: "uint", start: 0, end: 4, condition: "<" }, ({ i }) => {
        lColors.element(lIndex1.add(i)).xyz.assign(col);
        lColors.element(lIndex2.add(i)).xyz.assign(col);
        lPositions.element(lIndex1.add(i)).w.assign(l1);
        lPositions.element(lIndex2.add(i)).w.assign(l2);
      });
    });
  })().compute(nbParticles);

  // ---- spawner (reference shape; cursor + ambient share it, counts differ) ----
  const makeSpawnKernel = (posU, beforeU, nb, indexU) =>
    tslFn(() => {
      const pIndex = indexU.add(instanceIndex).remainder(nbParticles).toInt();
      const position = partPositions.element(pIndex).xyz;
      const velocity = partVelocities.element(pIndex).xyz;
      const life = partPositions.element(pIndex).w;
      life.assign(1.0);
      const rRange = float(0.01);
      const rTheta = pIndex.hash().mul(PI2);
      const rPhi = pIndex.add(2).hash().mul(PI);
      const rx = sin(rTheta).mul(cos(rPhi));
      const ry = sin(rTheta).mul(sin(rPhi));
      const rz = cos(rTheta);
      const dir = vec3(rx, ry, rz);
      const spread = nb > 1 ? instanceIndex.toFloat().div(float(nb - 1)).clamp(0.0, 1.0) : float(0.5);
      const pos = mix(beforeU, posU, spread);
      position.assign(pos.add(dir.mul(rRange)));
      velocity.assign(dir.mul(5.0));
    })().compute(nb);

  const spawnCursorKernel = makeSpawnKernel(uSpawnPosition, uSpawnPositionBefore, spawnNb, uSpawnIndex);
  const spawnAmbKernel = makeSpawnKernel(uSpawnAmb, uSpawnAmbBefore, 1, uSpawnIndexAmb);

  // ---- dark hex-pattern backdrop (reference look, near-black purple) ----
  {
    const geom = new IcosahedronGeometry(100, 1);
    const mat = new MeshBasicNodeMaterial();
    mat.colorNode = tslFn(() => {
      const npos = positionWorld.xyz.normalize();
      const theta = atan2(npos.z, npos.x);
      const phi = acos(npos.y);
      const dcol = color(0x000000).toVar();
      const st = vec2(theta, phi.add(1.0).mul(1.0)).toVar();
      st.y.addAssign(timerGlobal(0.1));
      st.x.mulAssign(0.5);
      const n2 = mx_fractal_noise_float(st, 4, 2.0, 0.5, 0.5).add(0.5);
      const icol = getInstanceColor(0);
      dcol.assign(mix(color(0x020204), icol.mul(1.2), cubicPulse(0.5, 0.02, n2)).pow(2.0));
      const pattern = hexagonPattern(vec2(phi, theta).mul(10.0));
      const n = pattern.z;
      const lit = smoothstep(0.8, 1.0, mx_fractal_noise_float(pattern.xy.add(timerGlobal(0.25)), 2, 2.0, 0.5, 0.5).add(0.5));
      return mix(dcol, mix(dcol.mul(0.5), mix(color(0x08080d), icol, lit), smoothstep(0.02, 0.03, n)), smoothstep(0.0, 0.02, n));
    })();
    mat.side = BackSide;
    const mesh = new Mesh(geom, mat);
    scene.add(mesh);
  }

  // ---- post: edge blur + bloom + rgb shift + fxaa (reference chain) ----
  const cornerDist = viewportTopLeft.distance(0.5).mul(2.0).clamp();
  const scenePass = pass(scene, camera);
  const post = new PostProcessing(renderer);
  const scenePassColor = scenePass.getTextureNode("output");
  const blurred = scenePassColor.gaussianBlur(cornerDist.pow(8.0));
  const bloomPass = bloom(scenePass, 1.0, 0.35, 0.55);
  const shift = rgbShift(blurred.add(bloomPass));
  shift.amount = cornerDist.pow(4.0).mul(0.004);
  shift.angle = atan2(viewportTopLeft.y.sub(0.5), viewportTopLeft.x.sub(0.5));
  post.outputNode = shift.fxaa();

  await renderer.computeAsync(initKernel);

  // ---- cursor projection onto z=0 (reference Pointer behavior) ----
  const raycaster = new Raycaster();
  const plane = new Plane(new Vector3(0, 0, 1), 0);
  const ndc = new Vector2();
  const hit = new Vector3();
  const lastClient = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const project = (clientX, clientY) => {
    ndc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    if (raycaster.ray.intersectPlane(plane, hit)) {
      return hit;
    }
    return null;
  };
  const onPointerMove = (e) => {
    lastClient.x = e.clientX;
    lastClient.y = e.clientY;
    uSpawnPositionBefore.value.copy(uSpawnPosition.value);
    const p = project(e.clientX, e.clientY);
    if (p) {
      uSpawnPosition.value.copy(p);
    }
  };
  window.addEventListener("pointermove", onPointerMove, { passive: true });

  // Slow ambient wander point so idle/touch pages stay alive.
  const wander = { a: Math.random() * 6.28, b: Math.random() * 6.28 };
  const stepWander = (now) => {
    wander.a += 0.0016;
    wander.b += 0.0011;
    uSpawnAmbBefore.value.copy(uSpawnAmb.value);
    uSpawnAmb.value.set(
      Math.sin(wander.a + now * 0.00011) * uBounds.value.x * 0.55,
      Math.sin(wander.b + now * 0.00007) * uBounds.value.y * 0.55,
      0
    );
  };

  const onResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    syncBounds();
    layout();
  };
  window.addEventListener("resize", onResize);

  const tick = () => {
    clock.getDelta();
    const now = performance.now();
    // Slow orbit (replaces drag controls: no scroll fighting).
    const a = now * 0.00012;
    camera.position.set(Math.sin(a) * 10, 3, Math.cos(a) * 10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    stepWander(now);
    renderer.compute(motionKernel);
    renderer.compute(spawnCursorKernel);
    uSpawnIndex.value = (uSpawnIndex.value + spawnNb) % nbParticles;
    renderer.compute(spawnAmbKernel);
    uSpawnIndexAmb.value = (uSpawnIndexAmb.value + 1) % nbParticles;
    // Ease the spawn point toward the pointer (reference easing).
    const p = project(lastClient.x, lastClient.y);
    if (p) {
      uSpawnPosition.value.x += (p.x - uSpawnPosition.value.x) * 0.1;
      uSpawnPosition.value.y += (p.y - uSpawnPosition.value.y) * 0.1;
      uSpawnPosition.value.z += (p.z - uSpawnPosition.value.z) * 0.1;
    }
    post.render();
  };

  const onVisibility = () => {
    if (document.hidden) {
      renderer.setAnimationLoop(null);
    } else if (!reduceMotion) {
      renderer.setAnimationLoop(tick);
    }
  };
  document.addEventListener("visibilitychange", onVisibility);

  if (reduceMotion) {
    for (let s = 0; s < 3; s++) {
      renderer.compute(motionKernel);
    }
    post.render();
  } else {
    clock.start();
    renderer.setAnimationLoop(tick);
  }

  return {
    stop() {
      renderer.setAnimationLoop(null);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onPointerMove);
      renderer.dispose();
    },
  };
}
