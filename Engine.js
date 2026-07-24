/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  DRDD DIPE CITY — Engine.js  (V13.4.1)                           ║
 * ║  Drop this file next to the game HTML + Factory.js, load with:   ║
 * ║     <script src="Engine.js"></script>   (after three.min.js)     ║
 * ║                                                                  ║
 * ║  WHAT IT DOES                                                    ║
 * ║  • window.Engine — a self-contained rendering upgrade layer:     ║
 * ║      – HDR post pipeline: bloom + per-world color grading        ║
 * ║      – Image-based environment lighting (PMREM, procedural sky)  ║
 * ║      – Desktop MSAA on the offscreen target (WebGL2 samples)     ║
 * ║      – Quality-tier gating (0 = off, 1 = grade only, 2 = full)   ║
 * ║  • NO Three.js "examples" modules are used — r148+ removed the   ║
 * ║    UMD addon builds, so the composer here is implemented from    ║
 * ║    scratch against the core THREE global. Zero new CDN deps.     ║
 * ║                                                                  ║
 * ║  SAFETY MODEL                                                    ║
 * ║  • Engine.render(scene,cam) is a drop-in for renderer.render.    ║
 * ║    ANY internal error permanently trips a fuse and every later   ║
 * ║    call falls straight through to renderer.render — the game     ║
 * ║    can never be broken by this file.                             ║
 * ║  • Tier 0 (or Engine missing entirely) = the exact pre-V13.4     ║
 * ║    rendering path, byte for byte.                                ║
 * ║                                                                  ║
 * ║  TUNING KNOBS (all at the top of the code below)                 ║
 * ║    ENV_ENABLED / ENV_LEVEL .... environment lighting on/strength ║
 * ║    DEFAULT_PROFILE ............ fallback grade when no world set ║
 * ║    (Per-world grades live in WORLD_REGISTRY in the HTML — each   ║
 * ║     registerWorld({... grade:{...}}) entry. Fields:              ║
 * ║       tint:[r,g,b] sat contrast vignette bloom threshold )       ║
 * ║  DOES NOT TOUCH gameplay, physics, cameras, UI, or levels.       ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */
(function () {
  'use strict';

  // ── Tuning knobs ────────────────────────────────────────────────────────────
  var ENV_ENABLED = true;   // image-based environment lighting (tier >= 1)
  var ENV_LEVEL   = 0.55;   // overall brightness of the procedural env sky
  var DEFAULT_PROFILE = {
    tint: [1.0, 1.0, 1.0], sat: 1.05, contrast: 1.03,
    vignette: 0.16, bloom: 0.5, threshold: 0.9
  };

  var E = {};               // the public Engine object
  var renderer = null;
  var ready = false;        // init succeeded
  var fused = false;        // a runtime error tripped the safety fuse
  var tier = 2;             // 0 off | 1 grade only | 2 grade + bloom
  var profile = null;       // active grade profile (merged over DEFAULT_PROFILE)
  var envTex = null;        // PMREM environment texture
  var envScenes = [];       // scenes we applied the env to (for un-apply)

  function fuse(where, err) {
    fused = true;
    try {
      console.warn('[Engine.js] disabled after error in ' + where + ':', err);
      if (window.__DIAG) window.__DIAG.push('warn', ['Engine.js fused off (' + where + '): ' + (err && err.message)]);
    } catch (e) {}
  }
  function active() { return ready && !fused && tier > 0 && !!renderer; }

  // ── Fullscreen-triangle helper (one shared geometry + ortho cam) ───────────
  var fsCam = null, fsGeo = null, fsMesh = null, fsScene = null;
  function fsInit() {
    fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    fsGeo = new THREE.BufferGeometry();
    fsGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    fsGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    fsScene = new THREE.Scene();
    fsMesh = new THREE.Mesh(fsGeo, null);
    fsMesh.frustumCulled = false;
    fsScene.add(fsMesh);
  }
  function fsPass(material, target) {
    fsMesh.material = material;
    renderer.setRenderTarget(target);
    renderer.render(fsScene, fsCam);
  }

  var VERT = [
    'varying vec2 vUv;',
    'void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }'
  ].join('\n');

  // ── Shaders ─────────────────────────────────────────────────────────────────
  // Bright-pass: soft-knee luminance threshold (HDR input from the scene target).
  var brightMat = null;
  function makeBrightMat() {
    return new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uThreshold: { value: 0.9 }, uKnee: { value: 0.35 } },
      vertexShader: VERT,
      fragmentShader: [
        'uniform sampler2D tSrc; uniform float uThreshold; uniform float uKnee; varying vec2 vUv;',
        'void main(){',
        '  vec3 c = texture2D(tSrc, vUv).rgb;',
        '  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));',
        '  float w = clamp((l - uThreshold + uKnee) / (2.0 * uKnee), 0.0, 1.0);',
        '  w = w * w * (3.0 - 2.0 * w);',
        '  gl_FragColor = vec4(c * w, 1.0);',
        '}'
      ].join('\n'),
      depthTest: false, depthWrite: false, toneMapped: false
    });
  }

  // Separable 9-tap gaussian blur.
  var blurMat = null;
  function makeBlurMat() {
    return new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2(1, 0) }, uTexel: { value: new THREE.Vector2(0, 0) } },
      vertexShader: VERT,
      fragmentShader: [
        'uniform sampler2D tSrc; uniform vec2 uDir; uniform vec2 uTexel; varying vec2 vUv;',
        'void main(){',
        '  vec2 o1 = uDir * uTexel * 1.3846153846;',
        '  vec2 o2 = uDir * uTexel * 3.2307692308;',
        '  vec3 c = texture2D(tSrc, vUv).rgb * 0.2270270270;',
        '  c += (texture2D(tSrc, vUv + o1).rgb + texture2D(tSrc, vUv - o1).rgb) * 0.3162162162;',
        '  c += (texture2D(tSrc, vUv + o2).rgb + texture2D(tSrc, vUv - o2).rgb) * 0.0702702703;',
        '  gl_FragColor = vec4(c, 1.0);',
        '}'
      ].join('\n'),
      depthTest: false, depthWrite: false, toneMapped: false
    });
  }

  // Final composite: scene + 3-mip bloom → ACES tonemap (three's exact fit) →
  // per-world grade (tint / saturation / contrast / vignette) → sRGB → screen.
  var finalMat = null;
  function makeFinalMat() {
    return new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: null }, tB1: { value: null }, tB2: { value: null }, tB3: { value: null },
        uBloom: { value: 0.5 }, uExposure: { value: 1.0 },
        uTint: { value: new THREE.Vector3(1, 1, 1) }, uSat: { value: 1.0 },
        uContrast: { value: 1.0 }, uVignette: { value: 0.16 }
      },
      vertexShader: VERT,
      fragmentShader: [
        'uniform sampler2D tScene; uniform sampler2D tB1; uniform sampler2D tB2; uniform sampler2D tB3;',
        'uniform float uBloom; uniform float uExposure;',
        'uniform vec3 uTint; uniform float uSat; uniform float uContrast; uniform float uVignette;',
        'varying vec2 vUv;',
        // ACES filmic fit — identical math to THREE.ACESFilmicToneMapping.
        'vec3 _drddFitRRT(vec3 v){',
        '  vec3 a = v * (v + 0.0245786) - 0.000090537;',
        '  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;',
        '  return a / b;',
        '}',
        'vec3 acesFilmic(vec3 color){',
        '  const mat3 IN = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);',
        '  const mat3 OUT = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);',
        '  color *= uExposure / 0.6;',
        '  color = IN * color;',
        '  color = _drddFitRRT(color);',
        '  color = OUT * color;',
        '  return clamp(color, 0.0, 1.0);',
        '}',
        'vec3 _drddToSRGB(vec3 c){',
        '  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c));',
        '}',
        'void main(){',
        '  vec3 hdr = texture2D(tScene, vUv).rgb;',
        '  vec3 bloom = texture2D(tB1, vUv).rgb * 0.5 + texture2D(tB2, vUv).rgb * 0.35 + texture2D(tB3, vUv).rgb * 0.25;',
        '  hdr += bloom * uBloom;',
        '  vec3 c = acesFilmic(hdr);',
        '  c *= uTint;',
        '  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));',
        '  c = mix(vec3(luma), c, uSat);',
        '  c = (c - 0.5) * uContrast + 0.5;',
        '  vec2 vp = vUv - 0.5;',
        '  c *= 1.0 - uVignette * smoothstep(0.35, 0.85, dot(vp, vp) * 2.0);',
        '  gl_FragColor = vec4(_drddToSRGB(clamp(c, 0.0, 1.0)), 1.0);',
        '}'
      ].join('\n'),
      depthTest: false, depthWrite: false, toneMapped: false
    });
  }

  // ── Render targets (sized to the drawing buffer; auto-resize on change) ────
  var rtScene = null, rtBright = null;
  var rtBlur = [];          // [ {a,b} x3 ]  ping-pong pairs at 1/2, 1/4, 1/8 res
  var rtW = 0, rtH = 0;
  var floatType = null;

  function disposeTargets() {
    if (rtScene) { rtScene.dispose(); rtScene = null; }
    if (rtBright) { rtBright.dispose(); rtBright = null; }
    for (var i = 0; i < rtBlur.length; i++) { rtBlur[i].a.dispose(); rtBlur[i].b.dispose(); }
    rtBlur = [];
  }

  function ensureTargets() {
    var size = new THREE.Vector2();
    renderer.getDrawingBufferSize(size);
    var w = Math.max(4, size.x | 0), h = Math.max(4, size.y | 0);
    if (w === rtW && h === rtH && rtScene) return;
    disposeTargets();
    rtW = w; rtH = h;
    var isGL2 = renderer.capabilities.isWebGL2;
    if (floatType === null) {
      floatType = (isGL2 || renderer.extensions.get('OES_texture_half_float')) ? THREE.HalfFloatType : THREE.UnsignedByteType;
    }
    var msaa = (isGL2 && !E.isMobile) ? 4 : 0;   // desktop AA on the offscreen target
    rtScene = new THREE.WebGLRenderTarget(w, h, {
      type: floatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: true, samples: msaa
    });
    rtBright = new THREE.WebGLRenderTarget(w >> 1, h >> 1, {
      type: floatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false
    });
    for (var lv = 0; lv < 3; lv++) {
      var bw = Math.max(4, w >> (lv + 1)), bh = Math.max(4, h >> (lv + 1));
      rtBlur.push({
        a: new THREE.WebGLRenderTarget(bw, bh, { type: floatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false }),
        b: new THREE.WebGLRenderTarget(bw, bh, { type: floatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false })
      });
    }
  }

  // ── Procedural environment (PMREM) — soft sky dome + sun + ground bounce ───
  function buildEnvironment() {
    try {
      var pmrem = new THREE.PMREMGenerator(renderer);
      var s = new THREE.Scene();
      // Gradient dome: sky → horizon → ground, rendered on the inside of a sphere.
      var domeMat = new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, toneMapped: false,
        uniforms: { uLevel: { value: ENV_LEVEL } },
        vertexShader: 'varying vec3 vW; void main(){ vW = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: [
          'varying vec3 vW; uniform float uLevel;',
          'void main(){',
          '  float h = normalize(vW).y;',
          '  vec3 sky = vec3(0.42, 0.58, 0.85);',
          '  vec3 hor = vec3(0.85, 0.78, 0.68);',
          '  vec3 gnd = vec3(0.28, 0.30, 0.26);',
          '  vec3 c = h > 0.0 ? mix(hor, sky, pow(h, 0.55)) : mix(hor, gnd, pow(-h, 0.5));',
          '  gl_FragColor = vec4(c * uLevel, 1.0);',
          '}'
        ].join('\n')
      });
      s.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), domeMat));
      // A bright "sun" patch high up gives materials a specular kick.
      var sun = new THREE.Mesh(new THREE.SphereGeometry(4, 16, 8), new THREE.MeshBasicMaterial({ color: 0xfff2d0 }));
      sun.material.color.multiplyScalar(6.0 * ENV_LEVEL);
      sun.position.set(18, 32, 12);
      s.add(sun);
      var rt = pmrem.fromScene(s, 0.04);
      envTex = rt.texture;
      domeMat.dispose(); sun.geometry.dispose(); sun.material.dispose();
      pmrem.dispose();
    } catch (e) { envTex = null; try { console.warn('[Engine.js] environment build failed:', e); } catch (e2) {} }
  }

  function applyEnv(scene) {
    if (!ENV_ENABLED || !envTex || !scene || !scene.isScene) return;
    if (scene.__engineNoEnv) return;
    if (tier < 1 || profile.env === false) {   // low tier or a night/no-IBL world
      if (scene.environment === envTex) scene.environment = null;
      return;
    }
    if (scene.environment !== envTex && !scene.environment) {  // never overwrite someone else's env
      scene.environment = envTex;
      if (envScenes.indexOf(scene) === -1) envScenes.push(scene);
    }
  }
  function stripEnv() {
    for (var i = 0; i < envScenes.length; i++) {
      if (envScenes[i].environment === envTex) envScenes[i].environment = null;
    }
    envScenes = [];
  }

  // ── The composed frame ──────────────────────────────────────────────────────
  function composeFrom(sceneTargetFilled) {
    // Bloom (tier 2 only)
    var doBloom = (tier >= 2) && profile.bloom > 0.001;
    if (doBloom) {
      brightMat.uniforms.tSrc.value = rtScene.texture;
      brightMat.uniforms.uThreshold.value = profile.threshold;
      fsPass(brightMat, rtBright);
      var src = rtBright.texture;
      for (var lv = 0; lv < 3; lv++) {
        var pair = rtBlur[lv];
        blurMat.uniforms.uTexel.value.set(1 / pair.a.width, 1 / pair.a.height);
        blurMat.uniforms.tSrc.value = src;
        blurMat.uniforms.uDir.value.set(1, 0);
        fsPass(blurMat, pair.a);
        blurMat.uniforms.tSrc.value = pair.a.texture;
        blurMat.uniforms.uDir.value.set(0, 1);
        fsPass(blurMat, pair.b);
        src = pair.b.texture;
      }
    }
    finalMat.uniforms.tScene.value = rtScene.texture;
    finalMat.uniforms.tB1.value = doBloom ? rtBlur[0].b.texture : blackTex;
    finalMat.uniforms.tB2.value = doBloom ? rtBlur[1].b.texture : blackTex;
    finalMat.uniforms.tB3.value = doBloom ? rtBlur[2].b.texture : blackTex;
    finalMat.uniforms.uBloom.value = profile.bloom;
    finalMat.uniforms.uExposure.value = renderer.toneMappingExposure;
    finalMat.uniforms.uTint.value.fromArray(profile.tint);
    finalMat.uniforms.uSat.value = profile.sat;
    finalMat.uniforms.uContrast.value = profile.contrast;
    finalMat.uniforms.uVignette.value = profile.vignette;
    fsPass(finalMat, null);
    renderer.setRenderTarget(null);
  }

  var blackTex = null;

  // ── GPU self-test (V13.4.1) ─────────────────────────────────────────────────
  // Shader COMPILE failures are logged by three, not thrown — so the runtime
  // fuse can't see them and the symptom would be a black screen. This test runs
  // once at init: push a known WHITE pixel through the real bright→blur→final
  // shader chain on the actual GPU and read the result back. If any shader
  // failed to compile, the readback comes back black → fuse Engine off BEFORE
  // the first game frame, and the game renders on the plain pre-Engine path.
  function selfTest() {
    var rtIn = null, rtA = null, rtB = null, rtOut = null, white = null;
    try {
      white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
      white.needsUpdate = true;
      var opts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
      rtIn = new THREE.WebGLRenderTarget(4, 4, opts);
      rtA = new THREE.WebGLRenderTarget(4, 4, opts);
      rtB = new THREE.WebGLRenderTarget(4, 4, opts);
      rtOut = new THREE.WebGLRenderTarget(4, 4, opts);
      // exercise every shader in the chain against real GL
      brightMat.uniforms.tSrc.value = white; brightMat.uniforms.uThreshold.value = 0.0;
      fsPass(brightMat, rtIn);
      blurMat.uniforms.tSrc.value = rtIn.texture; blurMat.uniforms.uTexel.value.set(0.25, 0.25);
      blurMat.uniforms.uDir.value.set(1, 0); fsPass(blurMat, rtA);
      blurMat.uniforms.tSrc.value = rtA.texture; blurMat.uniforms.uDir.value.set(0, 1); fsPass(blurMat, rtB);
      finalMat.uniforms.tScene.value = white;
      finalMat.uniforms.tB1.value = rtB.texture; finalMat.uniforms.tB2.value = rtB.texture; finalMat.uniforms.tB3.value = rtB.texture;
      finalMat.uniforms.uBloom.value = 0.0; finalMat.uniforms.uExposure.value = 1.0;
      finalMat.uniforms.uTint.value.fromArray([1, 1, 1]); finalMat.uniforms.uSat.value = 1.0;
      finalMat.uniforms.uContrast.value = 1.0; finalMat.uniforms.uVignette.value = 0.0;
      fsPass(finalMat, rtOut);
      renderer.setRenderTarget(null);
      var px = new Uint8Array(4);
      renderer.readRenderTargetPixels(rtOut, 1, 1, 1, 1, px);
      // white in → ACES + sRGB out must be clearly bright; black means a shader died
      if (px[0] < 32 && px[1] < 32 && px[2] < 32) {
        fuse('selfTest', new Error('pipeline produced black from white input (shader compile failure?) px=' + px[0] + ',' + px[1] + ',' + px[2]));
        return false;
      }
      try { console.log('[Engine.js] GPU self-test passed (px ' + px[0] + ',' + px[1] + ',' + px[2] + ')'); } catch (e) {}
      return true;
    } catch (err) {
      fuse('selfTest', err);
      return false;
    } finally {
      try {
        renderer.setRenderTarget(null);
        if (rtIn) rtIn.dispose(); if (rtA) rtA.dispose(); if (rtB) rtB.dispose();
        if (rtOut) rtOut.dispose(); if (white) white.dispose();
        brightMat.uniforms.tSrc.value = null; blurMat.uniforms.tSrc.value = null;
        finalMat.uniforms.tScene.value = null;
      } catch (e) {}
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** One-time setup. Safe to call once, right after the WebGLRenderer exists. */
  E.init = function (r) {
    try {
      renderer = r;
      E.isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
      fsInit();
      brightMat = makeBrightMat();
      blurMat = makeBlurMat();
      finalMat = makeFinalMat();
      blackTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
      blackTex.needsUpdate = true;
      profile = mergeProfile(null);
      buildEnvironment();
      ready = true;
      selfTest();   // fuses Engine off pre-first-frame if any shader failed
      try { console.log('[Engine.js] ' + (fused ? 'DISABLED (self-test failed) — plain rendering' : 'ready — HDR pipeline on, env ' + (envTex ? 'on' : 'off'))); } catch (e) {}
    } catch (err) { fuse('init', err); }
  };
  E.ready = function () { return ready && !fused; };

  /** Drop-in replacement for renderer.render(scene, camera). */
  E.render = function (scene, camera) {
    if (!active()) { renderer.render(scene, camera); return; }
    try {
      applyEnv(scene);
      ensureTargets();
      var prevTM = renderer.toneMapping;
      renderer.toneMapping = THREE.NoToneMapping;   // tonemap happens in the final pass
      renderer.setRenderTarget(rtScene);
      renderer.render(scene, camera);
      renderer.toneMapping = prevTM;
      composeFrom(true);
    } catch (err) {
      fuse('render', err);
      try { renderer.setRenderTarget(null); renderer.toneMapping = THREE.ACESFilmicToneMapping; } catch (e) {}
      renderer.render(scene, camera);
    }
  };

  /** Two-layer render (durag stage): bg ortho scene first, main scene on top. */
  E.renderLayered = function (bgScene, bgCam, scene, camera) {
    if (!active()) {
      renderer.autoClear = true; renderer.render(bgScene, bgCam);
      renderer.autoClear = false; renderer.render(scene, camera);
      renderer.autoClear = true; return;
    }
    try {
      applyEnv(scene);
      ensureTargets();
      var prevTM = renderer.toneMapping;
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.setRenderTarget(rtScene);
      renderer.autoClear = true;
      renderer.render(bgScene, bgCam);
      renderer.autoClear = false;
      renderer.render(scene, camera);
      renderer.autoClear = true;
      renderer.toneMapping = prevTM;
      composeFrom(true);
    } catch (err) {
      fuse('renderLayered', err);
      try { renderer.setRenderTarget(null); renderer.autoClear = true; renderer.toneMapping = THREE.ACESFilmicToneMapping; } catch (e) {}
      renderer.render(bgScene, bgCam);
      renderer.autoClear = false; renderer.render(scene, camera); renderer.autoClear = true;
    }
  };

  /** Quality gate, driven by the game's adaptive-quality tiers (0/1/2). */
  E.setQuality = function (t) {
    tier = Math.max(0, Math.min(2, t | 0));
    if (tier < 1) stripEnv(); // low tier: no env lighting cost, no post
    try { if (window.__DIAG) window.__DIAG.push('log', ['Engine quality tier → ' + tier]); } catch (e) {}
  };

  /** Apply the grade profile of the world that owns levelId (or default). */
  E.applyProfile = function (levelId) {
    var g = null;
    try {
      var WR = window.WORLD_REGISTRY;
      if (WR) {
        for (var k in WR) {
          var st = WR[k].stages || [];
          for (var i = 0; i < st.length; i++) {
            if (String(st[i]) === String(levelId)) { g = WR[k].grade || null; break; }
          }
          if (g) break;
        }
      }
    } catch (e) {}
    profile = mergeProfile(g);
  };

  function mergeProfile(g) {
    g = g || {};
    return {
      tint: g.tint || DEFAULT_PROFILE.tint,
      sat: g.sat !== undefined ? g.sat : DEFAULT_PROFILE.sat,
      contrast: g.contrast !== undefined ? g.contrast : DEFAULT_PROFILE.contrast,
      vignette: g.vignette !== undefined ? g.vignette : DEFAULT_PROFILE.vignette,
      bloom: g.bloom !== undefined ? g.bloom : DEFAULT_PROFILE.bloom,
      threshold: g.threshold !== undefined ? g.threshold : DEFAULT_PROFILE.threshold,
      env: g.env !== undefined ? g.env : true
    };
  }

  /** Resize hook — targets also self-check every frame, this is belt & braces. */
  E.resize = function () { rtW = 0; rtH = 0; };

  window.Engine = E;
  try { console.log('[Engine.js] Loaded — call Engine.init(renderer) once.'); } catch (e) {}
})();
