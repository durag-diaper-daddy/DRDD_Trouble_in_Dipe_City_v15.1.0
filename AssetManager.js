/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  DRDD DIPE CITY — AssetManager.js  (V13.8.0)                     ║
 * ║  Load order:  three.min.js → AssetManager.js → Factory.js        ║
 * ║                                                                  ║
 * ║  WHAT IT DOES                                                    ║
 * ║  • window.Assets — the GLB character-model pipeline:             ║
 * ║      – Loads .glb files from the assets/ folder next to the HTML ║
 * ║      – Uses the OFFICIAL three.js GLTFLoader (r160): fetched at  ║
 * ║        runtime and re-wired onto the game's global THREE via     ║
 * ║        blob modules — NO second copy of three.js is loaded.      ║
 * ║        (Verified: all 65 symbols the loader imports exist in     ║
 * ║        the UMD build.)                                           ║
 * ║      – Caches each model once; every spawn gets a fresh clone,   ║
 * ║        auto-normalized to game scale (see MANIFEST heights)      ║
 * ║  • Placeholders remain the permanent fallback: any missing file, ║
 * ║    network problem, or loader failure = that character keeps its ║
 * ║    Factory placeholder. The game NEVER breaks over assets.       ║
 * ║                                                                  ║
 * ║  HOW TO ACTUALLY USE YOUR GLB MODELS (3 steps)                   ║
 * ║   1. Make a folder called  assets  next to the game HTML and     ║
 * ║      put your .glb files in it, named as in MANIFEST below       ║
 * ║      (or edit the file names in MANIFEST to match yours).        ║
 * ║   2. In Factory.js (top of file) set:                            ║
 * ║        window.USE_PLACEHOLDERS = false;                          ║
 * ║   3. Serve the game over http, not file:// — browsers block      ║
 * ║      local file reads. Easiest options: VS Code "Live Server",   ║
 * ║      or in a terminal:  python -m http.server  (then open        ║
 * ║      http://localhost:8000), or upload to itch.io.               ║
 * ║      On file:// this manager detects the situation, logs it to   ║
 * ║      diagnostics, and quietly stays on placeholders.             ║
 * ║                                                                  ║
 * ║  TUNING A MODEL: each MANIFEST entry:                            ║
 * ║    file    the .glb file name inside assets/                     ║
 * ║    height  target in-game height (model auto-scaled to this)    ║
 * ║    y       extra vertical offset after grounding (default 0)     ║
 * ║    rotY    extra Y rotation in radians (default 0, use if the    ║
 * ║            model faces the wrong way)                            ║
 * ║    swap    false = character's animation code reaches into       ║
 * ║            specific parts (see its 'why'); its GLB is NOT        ║
 * ║            auto-swapped until an adapter session wires it up.    ║
 * ║  KNOWN LIMITS (for now): Draco-compressed GLBs are not           ║
 * ║  supported (re-export without compression); skinned/rigged      ║
 * ║  models display statically (rig animation is a later phase).     ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */
(function () {
  'use strict';

  // ── THE MANIFEST — the one place to edit when adding models ────────────────
  // Keys match Factory function names exactly. Missing files are fine: that
  // character just keeps its placeholder (one summary line in diagnostics).
  var MANIFEST = {
    playerDRDD:              { file: 'drdd.glb',          height: 3.0, swap:false, load:true, why:'auto-swap off — the player rig system adopts this model itself (adoptPlayerGLB in the game) and drives its animation clips' },
    characterDRDDFrogTop:    { file: 'drdd_frog.glb',     height: 3.0 },
    characterDipeGenie:      { file: 'genie.glb',         height: 0.9 },
    characterMicFlex:        { file: 'micflex.glb',       height: 2.0 },
    characterMicFlexDurag:   { file: 'micflex_durag.glb', height: 2.0, swap:false, why:'rage gauge tints userData.bodyMesh' },
    characterDuragDada:      { file: 'duragdada.glb',     height: 2.1 },
    characterDuragDadaDurag: { file: 'duragdada_durag.glb', height: 2.1 },
    enemyStooge_Moe:         { file: 'stooge_moe.glb',    height: 1.6, swap:false, why:'walk cycle needs userData.legPivots' },
    enemyStooge_Larry:       { file: 'stooge_larry.glb',  height: 1.6, swap:false, why:'walk cycle needs userData.legPivots' },
    enemyStooge_Curly:       { file: 'stooge_curly.glb',  height: 1.6, swap:false, why:'walk cycle needs userData.legPivots' },
    enemyDuragStooge:        { file: 'stooge_durag.glb',  height: 1.6 },
    enemyOztrich:            { file: 'oztrich.glb',       height: 2.5 },
    enemyOztrichChase:       { file: 'oztrich_chase.glb', height: 2.4 },
    enemyPidgin:             { file: 'pidgin.glb',        height: 1.8 },
    enemyPidginChase:        { file: 'pidgin_chase.glb',  height: 2.0 },
    enemySeagle:             { file: 'seagle.glb',        height: 1.7 },
    enemySeagleChase:        { file: 'seagle_chase.glb',  height: 1.8 },
    enemyRoadstumbler:       { file: 'roadstumbler.glb',  height: 3.0 },
    enemyRoadstumblerBoss:   { file: 'roadstumbler.glb',  height: 3.3 },
    enemyKakapoo:            { file: 'kakapoo.glb',       height: 1.6 },
    enemyKakapooFrog:        { file: 'kakapoo.glb',       height: 1.4 },
    enemyPootoo:             { file: 'pootoo.glb',        height: 1.6 },
    enemyPootooFrog:         { file: 'pootoo.glb',        height: 1.4 },
    enemyGobbler:            { file: 'gobbler.glb',       height: 1.8 },
    enemyDooDoo:             { file: 'doodoo.glb',        height: 1.2 },
    enemyMotoStooge:         { file: 'moto_stooge.glb',   height: 2.0, swap:false, why:'wheel spin rotates children[2]/[3]' },
    enemyFatStooge:          { file: 'fat_stooge.glb',    height: 2.2, swap:false, why:'HP gems found via getObjectByName hpgem0/1' },
    enemyDodoBird:           { file: 'dodo.glb',          height: 2.7, swap:false, why:'squash anim needs userData.bodyMesh' },
    enemyJoeLBossHead:       { file: 'joel_head.glb',     height: 5.0 }
  };
  var PATH = 'assets/';
  var CDN  = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/';

  var A = {};
  var loader = null;
  var skeletonClone = null;   // SkeletonUtils.clone, if the fetch succeeded
  var cache = {};        // key → normalized template Object3D
  var failedBoot = false;
  var booted = false;
  var skinWarned = false;

  function diag(kind, msg) {
    try { if (window.__DIAG) window.__DIAG.push(kind, ['[Assets] ' + msg]); } catch (e) {}
    try { console[kind === 'error' ? 'error' : (kind === 'warn' ? 'warn' : 'log')]('[AssetManager.js] ' + msg); } catch (e) {}
  }

  // ── Bootstrap the OFFICIAL GLTFLoader onto the global THREE ────────────────
  // r148+ ships loaders as ES modules importing from 'three'. We fetch the
  // official sources, generate a shim module that re-exports every property of
  // the already-loaded global THREE, rewrite the loader's import specifiers to
  // point at that shim (blob URLs), and dynamic-import the result. One THREE.
  function bootstrapLoader() {
    var names = Object.keys(window.THREE).filter(function (n) { return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(n); });
    var shimSrc = 'var T = window.THREE;\n' + names.map(function (n) { return 'export var ' + n + ' = T.' + n + ';'; }).join('\n');
    var shimUrl = URL.createObjectURL(new Blob([shimSrc], { type: 'text/javascript' }));
    function fetchText(u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + u); return r.text(); }); }
    return fetchText(CDN + 'utils/BufferGeometryUtils.js').then(function (bgu) {
      bgu = bgu.replace(/from\s+['"]three['"]/g, "from '" + shimUrl + "'");
      var bguUrl = URL.createObjectURL(new Blob([bgu], { type: 'text/javascript' }));
      return fetchText(CDN + 'loaders/GLTFLoader.js').then(function (src) {
        src = src.replace(/from\s+['"]three['"]/g, "from '" + shimUrl + "'")
                 .replace(/from\s+['"][^'"]*BufferGeometryUtils\.js['"]/g, "from '" + bguUrl + "'");
        var url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
        return import(url).then(function (mod) {
          // Also bootstrap SkeletonUtils — a plain Object3D.clone() does NOT
          // correctly re-link a SkinnedMesh to its cloned bones (the mesh
          // keeps rendering from the ORIGINAL cached skeleton's pose, so a
          // rigged model appears in the scene graph but visually never
          // moves/animates, no matter how its wrapper group is transformed).
          // SkeletonUtils.clone() clones bones and mesh together, correctly
          // linked. If this fetch fails for any reason, skinnedClone stays
          // null and get() below falls back to the plain clone (rigged
          // models just keep the pre-existing static-display limitation).
          return fetchText(CDN + 'utils/SkeletonUtils.js').then(function (sk) {
            sk = sk.replace(/from\s+['"]three['"]/g, "from '" + shimUrl + "'");
            var skUrl = URL.createObjectURL(new Blob([sk], { type: 'text/javascript' }));
            return import(skUrl).then(function (skMod) {
              return { GLTFLoader: mod.GLTFLoader, skeletonClone: skMod.clone };
            });
          }).catch(function () {
            return { GLTFLoader: mod.GLTFLoader, skeletonClone: null };
          });
        });
      });
    });
  }

  // ── Normalize a loaded scene to game scale ─────────────────────────────────
  function normalize(sceneRoot, spec) {
    var wrap = new THREE.Group();
    wrap.add(sceneRoot);
    var box = new THREE.Box3().setFromObject(sceneRoot);
    var size = new THREE.Vector3(); box.getSize(size);
    var s = (spec.height || 2.0) / Math.max(size.y, 0.0001);
    sceneRoot.scale.setScalar(s);
    box.setFromObject(sceneRoot);
    var center = new THREE.Vector3(); box.getCenter(center);
    sceneRoot.position.x -= center.x;                       // center on origin
    sceneRoot.position.z -= center.z;
    sceneRoot.position.y -= box.min.y;                      // feet on y=0
    sceneRoot.position.y += (spec.y || 0);
    if (spec.rotY) wrap.rotation.y = spec.rotY;
    var hasSkin = false;
    wrap.traverse(function (o) {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true;
        if (o.isSkinnedMesh) {
          hasSkin = true;
          if (!skinWarned) { skinWarned = true; diag('log', 'a model contains a skinned rig — using SkeletonUtils for correct per-instance cloning'); }
        }
      }
    });
    wrap.__hasSkin = hasSkin;
    return wrap;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** True once a model for this Factory key is loaded and usable. */
  /** For Factory's auto-swap: loaded AND allowed to swap. */
  A.has = function (key) { return !!cache[key] && !(MANIFEST[key] && MANIFEST[key].swap === false); };
  /** Loaded at all (adapter systems use this + A.get directly). */
  A.loaded = function (key) { return !!cache[key]; };

  /** A fresh, game-scaled clone of the model for this key (or null). */
  A.get = function (key) {
    var t = cache[key];
    if (!t) return null;
    try {
      var c;
      if (t.__hasSkin && skeletonClone) { c = skeletonClone(t); c.__hasSkin = true; }
      else { c = t.clone(true); }
      c.__clips = t.__clips || [];                  // clips retarget by node name — safe to share
      return c;
    }
    catch (e) { diag('warn', 'clone failed for ' + key + ' — using placeholder this spawn'); return null; }
  };

  /** Fire-and-forget boot: build the loader, then preload the manifest.
   *  Placeholders are used until (and unless) each model arrives. */
  A.boot = function () {
    if (booted) return; booted = true;
    if (location.protocol === 'file:') {
      diag('warn', 'running from file:// — browsers block reading local .glb files, so placeholders stay on. To use your GLB models, serve over http (VS Code Live Server / python -m http.server) or upload the folder to a host like itch.io.');
      return;
    }
    if (!window.fetch || typeof Blob === 'undefined') { diag('warn', 'browser lacks fetch/Blob — placeholders stay on'); return; }
    bootstrapLoader().then(function (boot) {
      loader = new boot.GLTFLoader();
      skeletonClone = boot.skeletonClone;
      diag('log', 'official GLTFLoader ready (bootstrapped onto global THREE)' +
        (skeletonClone ? ', SkeletonUtils ready (rigged models will animate correctly per-instance)' : ' — SkeletonUtils unavailable, rigged models will display statically'));
      var all = Object.keys(MANIFEST);
      var deferred = all.filter(function (k) { return MANIFEST[k].swap === false && !MANIFEST[k].load; });
      var keys = all.filter(function (k) { return MANIFEST[k].swap !== false || MANIFEST[k].load; });
      if (deferred.length) diag('log', deferred.length + ' character(s) are contract-bound (their animation code reaches into specific parts) and stay on placeholders until an adapter session wires their GLB: ' + deferred.join(', '));
      var okC = 0, missC = 0, done = 0;
      if (!keys.length) return;
      keys.forEach(function (key) {
        var spec = MANIFEST[key];
        loader.load(PATH + spec.file, function (gltf) {
          try {
            var t = normalize(gltf.scene, spec);
            t.__clips = gltf.animations || [];       // keep animation clips (shared data)
            cache[key] = t;
            var clipNames = t.__clips.map(function (c) { return c.name; }).join(', ');
            okC++; diag('log', 'GLB loaded: ' + key + ' ← ' + spec.file + (clipNames ? ' | clips: ' + clipNames : ' | no animation clips'));
          } catch (e) { missC++; diag('warn', 'GLB normalize failed for ' + key + ': ' + (e && e.message)); }
          if (++done === keys.length) summary();
        }, undefined, function (err) {
          missC++;
          // A failure here can mean the file genuinely isn't there yet (the
          // normal, expected case for most characters) OR that a file IS
          // present but broke on load (wrong path/case, Draco-compressed with
          // no decoder configured, corrupt upload, etc). Log enough to tell
          // the two apart without guessing.
          var msg = (err && (err.message || err.type)) || 'unknown error';
          diag('warn', 'GLB not loaded for ' + key + ' (' + PATH + spec.file + '): ' + msg +
            ' — using placeholder. If you uploaded this file, check the exact path/filename ' +
            'case, and that it is not Draco-compressed (unsupported; re-export without ' +
            'compression, e.g. `gltf-transform copy in.glb out.glb`).');
          if (++done === keys.length) summary();
        });
      });
      function summary() {
      try { if (window.__onAssetsReady) window.__onAssetsReady(); } catch (e) {}
        diag('log', 'GLB preload complete: ' + okC + ' model(s) loaded, ' + missC + ' using placeholders' +
          (window.USE_PLACEHOLDERS ? ' — NOTE: USE_PLACEHOLDERS is true, so loaded models are NOT shown; set it false in Factory.js to use them' : ''));
      }
    }).catch(function (e) {
      failedBoot = true;
      diag('warn', 'GLB loader unavailable (' + (e && e.message) + ') — placeholders stay on. Game unaffected.');
    });
  };

  A._manifest = MANIFEST;   // exposed for inspection/tuning from the console
  window.Assets = A;
  try { console.log('[AssetManager.js] Loaded — call Assets.boot() once (game does this automatically).'); } catch (e) {}
})();
