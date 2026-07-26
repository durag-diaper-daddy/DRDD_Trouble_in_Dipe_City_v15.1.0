/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  DRDD DIPE CITY — Factory.js  (v16.1.0)                                     ║
 * ║  Drop this file next to your game HTML, then add ONE tag:        ║
 * ║     <script src="Factory.js"></script>                           ║
 * ║  right before any other <script> that uses THREE.                ║
 * ║                                                                  ║
 * ║  WHAT IT DOES                                                    ║
 * ║  • Adds window.Factory — a single object with one function per   ║
 * ║    character / prop in the game.                                 ║
 * ║  • All colors, outfit pieces, proportions, sizes: UNCHANGED.     ║
 * ║  • Stiff boxes / cylinders → smooth capsules / spheres / lathed  ║
 * ║    torsos / tapered limbs with 24+ segment counts.               ║
 * ║  • Every function returns a THREE.Group ready to position.       ║
 * ║  • V13.5.0: limbs are single cached meshes (⅓ the draw calls);   ║
 * ║    limb/head/torso geometry is shared session-wide.              ║
 * ║                                                                  ║
 * ║  GLB MODELS (V13.8.0): set window.USE_PLACEHOLDERS = false and  ║
 * ║  see AssetManager.js — it loads assets/*.glb per its MANIFEST   ║
 * ║  and the wGLB export wrapper here swaps them in per character.  ║
 * ║                                                                  ║
 * ║  DOES NOT TOUCH any gameplay, physics, cameras, UI, or levels.   ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

window.USE_PLACEHOLDERS = false; // set false to load /assets/*.glb instead

(function () {
  'use strict';

  // (Asset paths now live in AssetManager.js — kept RELATIVE ('assets/') so the
  //  game works both at a domain root and in a GitHub Pages project subpath.)

  // ── Shared helpers ──────────────────────────────────────────────────────────

  /** Make a MeshStandardMaterial with the project's standard surface settings. */
  function mat(colorHex, opts) {
    opts = opts || {};
    var m = new THREE.MeshStandardMaterial({
      color: colorHex,
      roughness: opts.roughness !== undefined ? opts.roughness : 0.72,
      metalness: opts.metalness !== undefined ? opts.metalness : 0.0,
    });
    if (opts.emissive) {
      m.emissive = new THREE.Color(opts.emissive);
      m.emissiveIntensity = opts.emissiveIntensity || 0.5;
    }
    if (opts.transparent) { m.transparent = true; m.opacity = opts.opacity !== undefined ? opts.opacity : 0.85; }
    if (opts.side) m.side = opts.side;
    return m;
  }

  /** Create a mesh, set castShadow, return it. */
  function mk(geo, material) {
    var m = new THREE.Mesh(geo, material);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  // ── Shared geometry cache (V13.5.0) ─────────────────────────────────────────
  // Characters are rebuilt from scratch every level entry; before this cache,
  // every rebuild allocated fresh limb/head/torso geometry (and the teardown
  // disposal freed it) — constant VRAM churn. Now identical dimensions share
  // ONE geometry for the whole session. Cached geometries are registered with
  // the game's __protectResource() keep-set so the level-teardown disposal
  // sweep never frees them out from under other characters.
  // Keys quantize dimensions to 3 decimals (≤0.0005-unit rounding — invisible)
  // so randomized sizes (e.g. dread lengths) stay cache-bounded.
  var _geoCache = {};
  function _q(n) { return Math.round(n * 1000) / 1000; }
  function _cacheGeo(key, build) {
    var g = _geoCache[key];
    if (g) return g;
    g = build();
    _geoCache[key] = g;
    try { if (window.__protectResource) window.__protectResource(g); } catch (e) {}
    return g;
  }

  /**
   * Smooth tapered limb — V13.5.0: now a SINGLE mesh with a SINGLE geometry.
   *
   * Previously: CylinderGeometry shaft + two SphereGeometry hemisphere caps =
   * 3 meshes / 3 geometries per limb (an r128-era workaround; r160 has native
   * capsules, but THREE.CapsuleGeometry cannot taper and most limbs here do).
   * Now: one LatheGeometry whose profile is bottom hemisphere → tapered shaft
   * → top hemisphere, revolved around Y — the EXACT same silhouette and
   * overall height (h + rTop + rBot) as the old 3-mesh version, at ⅓ the
   * meshes/draw calls and with session-wide geometry sharing via the cache.
   *
   * Returns a Mesh (was a Group). Same Object3D API — position/rotation/
   * scale/add all behave identically; no caller reads .children.
   *
   * @param {number} rTop    top radius
   * @param {number} rBot    bottom radius
   * @param {number} h       shaft height (caps extend beyond, as before)
   * @param {Material} material
   * @param {number} segs    radial segments (default 16)
   */
  function limb(rTop, rBot, h, material, segs) {
    segs = segs || 16;
    try {
      rTop = _q(rTop); rBot = _q(rBot); h = _q(h);
      var key = 'L|' + rTop + '|' + rBot + '|' + h + '|' + segs;
      var geo = _cacheGeo(key, function () {
        var pts = [], CAP = 6, i, a;
        for (i = 0; i <= CAP; i++) {           // bottom hemisphere (pole → equator)
          a = -Math.PI / 2 + (i / CAP) * (Math.PI / 2);
          pts.push(new THREE.Vector2(rBot * Math.cos(a), -h / 2 + rBot * Math.sin(a)));
        }
        for (i = 0; i <= CAP; i++) {           // top hemisphere (equator → pole)
          a = (i / CAP) * (Math.PI / 2);
          pts.push(new THREE.Vector2(rTop * Math.cos(a), h / 2 + rTop * Math.sin(a)));
        }
        return new THREE.LatheGeometry(pts, segs);
      });
      return mk(geo, material);
    } catch (err) {
      // Never let a geometry problem break a character build — legacy 3-mesh path.
      try { console.warn('[Factory.js] limb lathe failed, using legacy path:', err); } catch (e) {}
      return _limbLegacy(rTop, rBot, h, material, segs);
    }
  }

  /** Pre-V13.5 limb (3 meshes). Kept ONLY as the limb() error fallback. */
  function _limbLegacy(rTop, rBot, h, material, segs) {
    segs = segs || 16;
    var g = new THREE.Group();
    var cyl = mk(new THREE.CylinderGeometry(rTop, rBot, h, segs, 1), material);
    g.add(cyl);
    var capT = mk(new THREE.SphereGeometry(rTop, segs, 8, 0, Math.PI * 2, 0, Math.PI / 2), material);
    capT.position.y = h / 2;
    g.add(capT);
    var capB = mk(new THREE.SphereGeometry(rBot, segs, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), material);
    capB.position.y = -h / 2;
    g.add(capB);
    return g;
  }

  /**
   * Simple smooth head: a SphereGeometry with 24 segments so it reads round.
   * V13.5.0: geometry is cached/shared per radius across all rebuilds.
   */
  function smoothHead(radius, material, scaleX, scaleY, scaleZ) {
    var r = _q(radius);
    var geo = _cacheGeo('H|' + r, function () { return new THREE.SphereGeometry(r, 24, 18); });
    var m = mk(geo, material);
    m.scale.set(scaleX || 1, scaleY || 1, scaleZ || 1);
    return m;
  }

  /**
   * Lathe-revolved torso. Points define the silhouette from bottom to top;
   * the lathe spins them around Y.  Gives a sculpted shoulder/chest/waist shape.
   * V13.5.0: geometry is cached/shared per unique silhouette across rebuilds.
   */
  function latheTorso(points, material, segs) {
    segs = segs || 24;
    var key = 'T|' + segs + '|' + points.map(function (p) { return _q(p[0]) + ',' + _q(p[1]); }).join(';');
    var geo = _cacheGeo(key, function () {
      var vecs = points.map(function (p) { return new THREE.Vector2(p[0], p[1]); });
      return new THREE.LatheGeometry(vecs, segs);
    });
    return mk(geo, material);
  }

  // (V13.8.0: the old inline loadGLB stub was removed — it depended on
  //  THREE.GLTFLoader, which no longer exists in the r160 UMD build, and is
  //  fully superseded by AssetManager.js + the wGLB export wrapper below.)

  // ═══════════════════════════════════════════════════════════════════════════
  //  FACTORY FUNCTIONS — one per character / prop
  //  Every function RETURNS a THREE.Group.
  //  Colors, outfit pieces, sizes: exactly as in the original code.
  //  Geometry: smooth (Capsule-like limbs, 24-seg spheres for heads, lathe torsos).
  // ═══════════════════════════════════════════════════════════════════════════

  // ─────────────────────────────────────────────────────────────────────────
  //  DRDD — the playable hero
  //  Blue tracksuit / navy open robe / durag / gold chains / dark shoes
  // ─────────────────────────────────────────────────────────────────────────
  function playerDRDD() {
    // (GLB swapping is handled by the wGLB wrapper at export time — this
    //  function always builds the procedural placeholder.)

    var g = new THREE.Group();

    // ── Materials (same hex values as buildFallback in the game) ──────────
    var mSkin   = mat(0xd4956a);
    var mBlue   = mat(0x1a8cd8);                                 // tracksuit
    var mBlueDk = mat(0x1472b5);                                 // darker blue legs
    var mNavy   = mat(0x1a2535);                                 // robe
    var mGold   = mat(0xf0b800, {emissive:0x3a2800, emissiveIntensity:0.7, metalness:0.25, roughness:0.45});
    var mWhite  = mat(0xf0f0f0);
    var mDark   = mat(0x111520);                                 // shoes
    var mBeard  = mat(0xa0522d);
    var mBandana= mat(0x1a8cd8);

    // ── LEGS (smooth tapered capsule limbs) ──────────────────────────────
    // Each leg is its own Group (leg + ankle cuff) so the game's walk-cycle
    // code can rotate it as one piece — same behavior as the original boxy leg.
    var legGroups = [];
    [-0.20, 0.20].forEach(function (lx) {
      var legHolder = new THREE.Group();
      legHolder.position.set(lx, -0.72, 0);
      var legGrp = limb(0.13, 0.115, 0.68, mBlueDk, 14);
      legHolder.add(legGrp);
      // Ankle cuff — thin torus instead of a box
      var cuff = mk(new THREE.TorusGeometry(0.14, 0.045, 10, 18), mBlue);
      cuff.rotation.x = Math.PI / 2;
      cuff.position.set(0, -0.30, 0); // relative to legHolder origin (was -1.02 absolute, -0.72 leg base = -0.30 offset)
      legHolder.add(cuff);
      g.add(legHolder);
      legGroups.push(legHolder);
    });

    // ── SHOES (rounded box → smooth pill-shaped shoe) ────────────────────
    var shoeGroups = [];
    [-0.20, 0.20].forEach(function (sx) {
      var shoeHolder = new THREE.Group();
      shoeHolder.position.set(sx, -1.12, 0.07);
      var shoe = mk(new THREE.CapsuleGeometry(0.13, 0.22, 6, 12), mDark);
      shoe.rotation.z = Math.PI / 2;  // lay it horizontal like a shoe
      shoeHolder.add(shoe);
      // White sole strip (thin disc)
      var sole = mk(new THREE.CylinderGeometry(0.135, 0.135, 0.04, 12), mWhite);
      sole.rotation.z = Math.PI / 2;
      sole.position.set(0, 0.045, 0); // relative offset (was -1.075 absolute, -1.12 shoe base = 0.045 offset)
      shoeHolder.add(sole);
      g.add(shoeHolder);
      shoeGroups.push(shoeHolder);
    });

    // ── TORSO — lathe-revolved for a sculpted tracksuit silhouette ────────
    var torso = latheTorso([
      [0.20, -0.45],  // waist bottom
      [0.34, -0.10],  // hip flare
      [0.38,  0.05],  // mid torso
      [0.41,  0.25],  // chest
      [0.40,  0.45],  // shoulder base
      [0.22,  0.67],  // neck
    ], mBlue, 20);
    torso.position.y = 0.22;
    g.add(torso);

    // Collar / neck ring
    var collar = limb(0.17, 0.20, 0.22, mBlue, 12);
    collar.position.y = 0.78;
    g.add(collar);

    // Diaper-print detail squares (flat, same positions as original)
    var mDpW = mat(0xfafafa, {roughness:0.9});
    var mDpY = mat(0xffe066, {roughness:0.9});
    var dipePts = [
      [-0.22,0.45,0.33,0.16,0.16], [0.22,0.45,0.33,0.16,0.16],
      [-0.22,0.18,0.33,0.16,0.16], [0.22,0.18,0.33,0.16,0.16],
      [  0, 0.05,0.33,0.14,0.14],
      [-0.22,0.45,-0.33,0.16,0.16],[0.22,0.45,-0.33,0.16,0.16],
    ];
    dipePts.forEach(function (d, i) {
      var dp = mk(new THREE.BoxGeometry(d[3], d[4], 0.03), i % 3 === 0 ? mDpY : mDpW);
      dp.position.set(d[0], d[1], d[2]);
      g.add(dp);
    });

    // ── ROBE / COAT — segmented flap-able cape panels ─────────────────────
    // Instead of one flat back-slab, build 4 overlapping rounded panels that
    // hang from the shoulders. The game's walk cycle can rotate these via
    // userData.capeSegs (same interface as the Fighter level uses for cape sway).
    var capeSegs = [];
    var mNavyDk = mat(0x111d2a);
    // Root panel — attached high at shoulder blade level
    var capeRoot = new THREE.Group();
    capeRoot.position.set(0, 0.72, -0.28);
    g.add(capeRoot);
    // 4 panels hanging downward, each a flattened rounded sphere
    var panelHeights = [0, -0.28, -0.54, -0.76];
    var panelWidths  = [0.88, 0.82, 0.72, 0.56];
    panelHeights.forEach(function(py, i) {
      var pivot = new THREE.Group();
      pivot.position.set(0, py, 0);
      var panel = mk(new THREE.CapsuleGeometry(0.12, panelWidths[i], 4, 10), i === 0 ? mNavy : mNavyDk);
      panel.rotation.z = Math.PI / 2;   // lay horizontal
      panel.scale.set(1, 1, 0.18);      // squash to a flat sheet
      panel.position.set(0, 0, -0.08 - i * 0.06); // each panel angles slightly further back
      pivot.add(panel);
      if (i > 0) capeSegs.push(pivot);  // seg 0 is shoulder-root, segs 1-3 flap
      capeRoot.add(pivot);
    });
    g.userData.capeSegs = capeSegs;

    // Shoulder pads (over cape top)
    [-0.50, 0.50].forEach(function (sx) {
      var sh = mk(new THREE.SphereGeometry(0.22, 12, 10), mNavy);
      sh.scale.set(1, 0.65, 1.3);
      sh.position.set(sx, 0.68, 0);
      g.add(sh);
    });
    // Lapels — smooth curved panels
    [-1, 1].forEach(function (side) {
      var lap = mk(new THREE.CapsuleGeometry(0.10, 0.82, 6, 10), mNavy);
      lap.position.set(side * 0.48, 0.20, 0.12);
      lap.rotation.z = -side * 0.22;
      lap.scale.set(1, 1, 0.28);
      g.add(lap);
    });

    // ── ARMS (smooth tapered capsule) ─────────────────────────────────────
    [-0.58, 0.58].forEach(function (ax) {
      var arm = limb(0.12, 0.10, 0.72, mBlue, 12);
      arm.position.set(ax, 0.14, 0);
      g.add(arm);
      // Robe sleeve over arm
      var slv = limb(0.14, 0.12, 0.70, mNavy, 12);
      slv.position.set(ax, 0.14, -0.06);
      g.add(slv);
    });

    // Wrists / hands (smooth sphere instead of box)
    var mHand = mat(0xd4956a);
    [-0.58, 0.58].forEach(function (ax) {
      var hand = mk(new THREE.SphereGeometry(0.11, 14, 10), mHand);
      hand.scale.set(1.1, 0.9, 0.9);
      hand.position.set(ax, -0.32, 0.04);
      g.add(hand);
    });
    // Gold watch left wrist
    var watch = mk(new THREE.TorusGeometry(0.11, 0.03, 8, 16), mGold);
    watch.rotation.z = Math.PI / 2;
    watch.position.set(-0.58, -0.26, 0.04);
    g.add(watch);
    // Gold ring right hand
    var ring = mk(new THREE.TorusGeometry(0.05, 0.018, 6, 10), mGold);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0.60, -0.38, 0.09);
    g.add(ring);

    // ── THREE GOLD CHAINS ─────────────────────────────────────────────────
    var chainSegs = 14;
    [0, 1, 2].forEach(function (ci) {
      var r = 0.25 + ci * 0.055, dip = 0.14 + ci * 0.04;
      var fwd = 0.34 - ci * 0.04, yBase = 0.60 - ci * 0.07;
      for (var i = 0; i <= chainSegs; i++) {
        var t = i / chainSegs, angle = t * Math.PI;
        var lx2 = Math.cos(Math.PI - angle) * r;
        var ly2 = yBase - Math.sin(angle) * dip;
        // Smooth torus link instead of box
        var lk = mk(new THREE.TorusGeometry(0.032, 0.014, 6, 10), mGold);
        lk.position.set(lx2, ly2, fwd);
        lk.rotation.z = angle;
        lk.rotation.x = (i % 2 === 0) ? Math.PI / 2 : 0;
        lk.scale.set(1, 1.4, 1);
        g.add(lk);
      }
    });
    // "D" medallion (disc)
    var medal = mk(new THREE.CylinderGeometry(0.095, 0.095, 0.038, 14), mGold);
    medal.position.set(0, 0.30, 0.35);
    g.add(medal);

    // ── HEAD — smooth sphere instead of box ───────────────────────────────
    var head = smoothHead(0.375, mSkin, 1.04, 0.96, 0.99);
    head.position.y = 1.04;
    g.add(head);
    // Jaw — slightly wider sphere at bottom of head
    var jaw = mk(new THREE.SphereGeometry(0.34, 20, 14), mSkin);
    jaw.scale.set(1.0, 0.45, 0.95);
    jaw.position.y = 0.78;
    g.add(jaw);
    // Cheeks
    [-0.36, 0.36].forEach(function (cx2) {
      var ck = mk(new THREE.SphereGeometry(0.16, 12, 8), mSkin);
      ck.scale.set(1, 0.75, 0.8);
      ck.position.set(cx2, 1.02, 0.26);
      g.add(ck);
    });
    // Nose
    var nose = mk(new THREE.SphereGeometry(0.065, 10, 8), mat(0xc07858));
    nose.scale.set(1, 0.85, 0.75);
    nose.position.set(0, 0.99, 0.39);
    g.add(nose);
    // Eyes
    var mEyeW = mat(0xfafafa);
    var mEyeB = mat(0x5588bb);
    var mPupil = mat(0x111111);
    [-0.20, 0.20].forEach(function (ex) {
      var ew = mk(new THREE.SphereGeometry(0.072, 10, 8), mEyeW); ew.scale.set(1.1, 0.85, 0.5); ew.position.set(ex, 1.07, 0.37); g.add(ew);
      var ei = mk(new THREE.SphereGeometry(0.048, 10, 8), mEyeB); ei.scale.set(1, 1, 0.6);  ei.position.set(ex, 1.07, 0.38); g.add(ei);
      var ep = mk(new THREE.SphereGeometry(0.028, 8, 6), mPupil); ep.position.set(ex, 1.07, 0.395); g.add(ep);
      // Eyebrow — thin rounded bar
      var eb = mk(new THREE.CapsuleGeometry(0.022, 0.14, 4, 8), mBeard);
      eb.rotation.z = Math.PI / 2;
      eb.position.set(ex, 1.15, 0.37);
      g.add(eb);
    });
    // Smile / teeth
    var mTeeth = mat(0xffffff);
    var smile = mk(new THREE.CapsuleGeometry(0.028, 0.30, 4, 8), mTeeth);
    smile.rotation.z = Math.PI / 2;
    smile.position.set(0, 0.88, 0.39);
    g.add(smile);
    // Beard / stubble patch
    var beardPatch = mk(new THREE.SphereGeometry(0.24, 14, 10), mBeard);
    beardPatch.scale.set(1.3, 0.6, 0.18);
    beardPatch.position.set(0, 0.83, 0.38);
    g.add(beardPatch);
    // Ear studs
    var mStud = mat(0xf0c000, {emissive:0x443300, emissiveIntensity:0.8, metalness:0.3});
    [-0.40, 0.40].forEach(function (ex) {
      var stud = mk(new THREE.SphereGeometry(0.042, 10, 8), mStud);
      stud.position.set(ex, 1.04, 0.04);
      g.add(stud);
    });
    // Ears
    [-0.40, 0.40].forEach(function (ex) {
      var ear = mk(new THREE.SphereGeometry(0.09, 12, 8), mSkin);
      ear.scale.set(0.45, 0.65, 0.45);
      ear.position.set(ex, 1.02, 0.0);
      g.add(ear);
    });

    // ── BANDANA / DURAG ───────────────────────────────────────────────────
    // Main cap — rounded top
    var bandCap = mk(new THREE.SphereGeometry(0.40, 20, 12, 0, Math.PI*2, 0, Math.PI*0.55), mBandana);
    bandCap.position.y = 1.26;
    g.add(bandCap);
    // Mid band
    var bandMid = mk(new THREE.CylinderGeometry(0.40, 0.41, 0.22, 20), mBandana);
    bandMid.position.y = 1.36;
    g.add(bandMid);
    // Fold crease ring (slightly darker fold-line)
    var mFold = mat(0x1278b8);
    var bandFold = mk(new THREE.TorusGeometry(0.41, 0.025, 8, 24), mFold);
    bandFold.rotation.x = Math.PI / 2;
    bandFold.position.y = 1.25;
    g.add(bandFold);
    // Knot at back
    var knot = mk(new THREE.SphereGeometry(0.11, 12, 8), mBandana);
    knot.scale.set(1.1, 0.8, 0.65);
    knot.position.set(0, 1.30, -0.45);
    g.add(knot);
    var knotTail = mk(new THREE.CapsuleGeometry(0.045, 0.22, 6, 10), mBandana);
    knotTail.position.set(0.06, 1.14, -0.46);
    knotTail.rotation.z = 0.15;
    g.add(knotTail);
    // White polka dots on bandana
    var mSpot = mat(0xffffff);
    [[-0.30,1.42,0.40],[-0.10,1.45,0.42],[0.12,1.44,0.41],[0.32,1.42,0.40],
     [-0.20,1.30,0.42],[0.0,1.32,0.43],[0.22,1.30,0.42],
     [-0.42,1.38,0.20],[-0.44,1.38,-0.05],[-0.42,1.38,-0.28],
      [0.42,1.38,0.20],[0.44,1.38,-0.05],[0.42,1.38,-0.28],
     [-0.22,1.40,-0.38],[0.0,1.42,-0.40],[0.22,1.40,-0.38]
    ].forEach(function (p) {
      var sp = mk(new THREE.SphereGeometry(0.038, 7, 6), mSpot);
      sp.position.set(p[0], p[1], p[2]);
      g.add(sp);
    });
    // Dots on pants legs
    [[-0.20,-0.52,0.16],[-0.20,-0.72,0.16],[-0.20,-0.92,0.16],
      [0.20,-0.52,0.16],[0.20,-0.72,0.16],[0.20,-0.92,0.16],
     [-0.08,-0.62,0.14],[0.08,-0.62,0.14]
    ].forEach(function (p) {
      var ps = mk(new THREE.SphereGeometry(0.040, 7, 6), mSpot);
      ps.position.set(p[0], p[1], p[2]);
      g.add(ps);
    });

    // Invisible head sensor (game code spins "hs" — keep it here)
    var hs = mk(new THREE.SphereGeometry(0.001, 3, 2), new THREE.MeshStandardMaterial({visible:false}));
    hs.position.set(0, 1.6, 0);
    g.add(hs);

    // Expose leg/shoe groups via same names the game's animation accesses
    // (ll/rl/ls/rs — leg-left, leg-right, shoe-left, shoe-right)
    g.userData.hs = hs;
    g.userData.ll = legGroups[0];
    g.userData.rl = legGroups[1];
    g.userData.ls = shoeGroups[0];
    g.userData.rs = shoeGroups[1];

    return g;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  STOOGE ENEMY  (Moe / Larry / Curly — same buildEnemy base)
  //  type 0=Moe, 1=Larry, 2=Curly
  // ─────────────────────────────────────────────────────────────────────────
  function enemyStooge(type, shirtColor, shirtEmit) {
    type = type || 0;
    shirtColor = shirtColor || 0x44aa44;
    shirtEmit  = shirtEmit  || 0x112211;
    var g = new THREE.Group();

    var mSkin   = mat(0xf5c8a0);
    var mEyeW   = mat(0xffffff);
    var mPupil  = mat(0x111111);
    var mBrow   = mat(0x4a2800);
    var mHair   = mat(type === 2 ? 0xf5c8a0 : 0x1a1a1a);
    var mShirt  = mat(shirtColor, {emissive:shirtEmit, emissiveIntensity:0.4});
    var mMouth  = mat(0x991111);

    // HEAD — smooth sphere with flattened scale
    var head = smoothHead(0.52, mSkin, 1, 1.08, 1);
    head.position.y = 0;
    g.add(head);
    // Nose
    var nose = mk(new THREE.SphereGeometry(0.11, 10, 8), mSkin);
    nose.scale.set(1, 0.75, 0.8);
    nose.position.set(0, 0.02, 0.50);
    g.add(nose);
    // Eyes
    [-0.20, 0.20].forEach(function (ex) {
      var ew = mk(new THREE.SphereGeometry(0.10, 10, 8), mEyeW); ew.position.set(ex, 0.16, 0.44); g.add(ew);
      var ep = mk(new THREE.SphereGeometry(0.05, 8, 6), mPupil); ep.position.set(ex, 0.16, 0.53); g.add(ep);
      // Brow — rounded capsule
      var br = mk(new THREE.CapsuleGeometry(0.022, 0.12, 4, 8), mBrow);
      br.rotation.z = ex < 0 ? 0.45 : -0.45;
      br.rotation.y = Math.PI / 2;
      br.position.set(ex, 0.32, 0.46);
      g.add(br);
    });
    // Mouth
    var mouthBar = mk(new THREE.CapsuleGeometry(0.025, 0.22, 4, 8), mMouth);
    mouthBar.rotation.z = Math.PI / 2;
    mouthBar.position.set(0, -0.18, 0.50);
    g.add(mouthBar);
    // Ears
    [-0.52, 0.52].forEach(function (ex) {
      var ear = mk(new THREE.SphereGeometry(0.10, 10, 8), mSkin);
      ear.scale.set(0.5, 0.7, 0.5);
      ear.position.set(ex, 0, 0);
      g.add(ear);
    });

    // ── Hair per stooge type ──────────────────────────────────────────────
    if (type === 0) {
      // MOE — bowl cut (sized down ~15% per Christopher's request)
      var bowl = mk(new THREE.SphereGeometry(0.46, 16, 8, 0, Math.PI*2, 0, Math.PI*0.45), mHair);
      bowl.position.y = 0.10;
      g.add(bowl);
      var fringe = mk(new THREE.CapsuleGeometry(0.049, 0.63, 6, 10), mHair);
      fringe.rotation.z = Math.PI / 2;
      fringe.position.set(0, 0.26, 0.42);
      g.add(fringe);
      [-0.40, 0.40].forEach(function (sx) {
        var side = limb(0.06, 0.06, 0.30, mHair, 8);
        side.position.set(sx, 0.0, 0.09);
        g.add(side);
      });
    } else if (type === 1) {
      // LARRY — frizzy side puffs (sized down ~15%)
      var baldTop = mk(new THREE.SphereGeometry(0.45, 14, 8, 0, Math.PI*2, 0, Math.PI*0.3), mSkin);
      baldTop.position.y = 0.22;
      g.add(baldTop);
      [[-0.50,0,-0.05],[0.50,0,-0.05],[-0.36,-0.09,-0.38],[0.36,-0.09,-0.38],[0,-0.09,-0.50]].forEach(function (p) {
        var puff = mk(new THREE.SphereGeometry(0.17 + Math.random()*0.07, 10, 8), mHair);
        puff.position.set(p[0], p[1], p[2]);
        puff.scale.set(0.9, 0.7, 0.8);
        g.add(puff);
      });
    } else {
      // CURLY — bald, stubble ring
      var mStubble = mat(0xaaaaaa);
      var ring2 = mk(new THREE.TorusGeometry(0.44, 0.04, 6, 18), mStubble);
      ring2.rotation.x = Math.PI / 2;
      ring2.position.y = 0.20;
      g.add(ring2);
    }

    // ── LEGS — smooth capsule, built INSIDE pivot groups so the game's ──────
    // walk-cycle code (which rotates a pivot at the hip) still works.
    // Pivot origin = hip (same point the original boxy legs rotated around).
    // Leg/foot radius sized down ~15% per Christopher's request (length unchanged
    // so feet still reach the ground at the same spot).
    var legPivots = [];
    [-0.25, 0.25].forEach(function (fx) {
      var pivot = new THREE.Group();
      pivot.position.set(fx, -0.45, 0);
      var legG = limb(0.072, 0.064, 0.36, mShirt, 10);
      legG.position.set(0, -0.18, 0); // hangs below the hip pivot, same as original
      pivot.add(legG);
      var foot = mk(new THREE.SphereGeometry(0.085, 10, 8), mShirt);
      foot.scale.set(1, 0.8, 1.1);
      foot.position.set(0, -0.36, 0.04);
      pivot.add(foot);
      g.add(pivot);
      legPivots.push(pivot);
    });
    g.userData.legPivots = legPivots;

    // ── TORSO — lathe revolved ─────────────────────────────────────────────
    var torso = latheTorso([
      [0.12, -0.38],
      [0.20, -0.15],
      [0.24,  0.10],
      [0.26,  0.30],
      [0.22,  0.46],
      [0.14,  0.55],
    ], mShirt, 16);
    torso.position.y = 0.60;
    g.add(torso);

    // Arms
    [-0.30, 0.30].forEach(function (ax) {
      var arm = limb(0.085, 0.075, 0.40, mShirt, 10);
      arm.position.set(ax, 0.72, 0);
      g.add(arm);
    });

    return g;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  MIC FLEX — hero ally
  //  Puffer hood / navy jacket / shotgun prop
  // ─────────────────────────────────────────────────────────────────────────
  function characterMicFlex() {
    var g = new THREE.Group();

    var mSkin   = mat(0xc8a07a);
    var mPuffer = mat(0x1a1a2a);   // dark quilted puffer
    var mGold   = mat(0xf0b800, {metalness:0.25, roughness:0.45});
    var mGun    = mat(0x222233);

    // HEAD
    var head = smoothHead(0.34, mSkin);
    head.position.y = 1.30;
    g.add(head);
    // Hood / puffer over head
    var hood = mk(new THREE.SphereGeometry(0.40, 18, 14, 0, Math.PI*2, 0, Math.PI*0.6), mPuffer);
    hood.position.y = 1.30;
    g.add(hood);
    // Eyes
    var mEyeW = mat(0xf0f0f0); var mPupil = mat(0x111111);
    [-0.14, 0.14].forEach(function (ex) {
      var ew = mk(new THREE.SphereGeometry(0.070, 10, 8), mEyeW); ew.position.set(ex, 1.36, 0.34); g.add(ew);
      var ep = mk(new THREE.SphereGeometry(0.040, 8, 6), mPupil); ep.position.set(ex, 1.36, 0.39); g.add(ep);
    });
    // Mustache
    var mMu = mat(0x3a2200);
    var mu = mk(new THREE.CapsuleGeometry(0.025, 0.20, 4, 8), mMu);
    mu.rotation.z = Math.PI / 2;
    mu.position.set(0, 1.24, 0.36);
    g.add(mu);

    // TORSO — lathe
    var torso = latheTorso([
      [0.18, -0.42], [0.28, -0.10], [0.32, 0.22], [0.30, 0.48], [0.18, 0.65],
    ], mPuffer, 18);
    torso.position.y = 0.28;
    g.add(torso);
    // Quilted horizontal ribs (rings)
    [-0.05, 0.20, 0.45].forEach(function (ry) {
      var rib = mk(new THREE.TorusGeometry(0.28, 0.025, 6, 18), mat(0x252535));
      rib.rotation.x = Math.PI / 2;
      rib.position.y = ry;
      g.add(rib);
    });
    // Gold chain
    var chainR = 0.25;
    for (var ci = 0; ci <= 10; ci++) {
      var a = ci / 10 * Math.PI;
      var lk = mk(new THREE.TorusGeometry(0.030, 0.012, 6, 10), mGold);
      lk.position.set(Math.cos(Math.PI - a) * chainR, 0.68 - Math.sin(a)*0.12, 0.30);
      lk.rotation.z = a;
      lk.rotation.x = (ci % 2 === 0) ? Math.PI/2 : 0;
      lk.scale.set(1, 1.4, 1);
      g.add(lk);
    }

    // LEGS
    [-0.18, 0.18].forEach(function (lx) {
      var leg = limb(0.12, 0.10, 0.70, mat(0x1a1a2a), 12);
      leg.position.set(lx, -0.62, 0);
      g.add(leg);
    });
    // Shoes
    [-0.18, 0.18].forEach(function (sx) {
      var shoe = mk(new THREE.CapsuleGeometry(0.11, 0.20, 6, 12), mat(0x111111));
      shoe.rotation.z = Math.PI / 2;
      shoe.position.set(sx, -1.02, 0.06);
      g.add(shoe);
    });

    // ARMS
    [-0.36, 0.36].forEach(function (ax) {
      var arm = limb(0.10, 0.085, 0.55, mPuffer, 10);
      arm.position.set(ax, 0.55, 0);
      g.add(arm);
    });

    // TWIN-BARREL SHOTGUN (right hand prop)
    var gunGrp = new THREE.Group();
    // Two barrels side by side
    [-0.05, 0.05].forEach(function (bx) {
      var barrel = limb(0.025, 0.025, 0.60, mGun, 8);
      barrel.position.set(bx, 0, 0);
      gunGrp.add(barrel);
    });
    // Stock
    var stock = mk(new THREE.BoxGeometry(0.12, 0.08, 0.25), mat(0x5c3a1e));
    stock.position.set(0, 0, -0.28);
    gunGrp.add(stock);
    gunGrp.position.set(0.44, 0.26, 0.20);
    gunGrp.rotation.x = -0.3;
    g.add(gunGrp);

    return g;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  DURAG DADA — hero ally
  //  Black durag / gold aviators / dreads / goatee / gold chain
  // ─────────────────────────────────────────────────────────────────────────
  function characterDuragDada() {
    var g = new THREE.Group();

    var mSkin   = mat(0xb87050);
    var mDurag  = mat(0x111111);    // black durag
    var mGold   = mat(0xf0b800, {metalness:0.3, roughness:0.4});
    var mDread  = mat(0x2a1a08);    // dark brown dreads
    var mJacket = mat(0x224422);    // army-green jacket

    // HEAD
    var head = smoothHead(0.34, mSkin);
    head.position.y = 1.30;
    g.add(head);
    // Durag cap
    var cap = mk(new THREE.SphereGeometry(0.37, 18, 12, 0, Math.PI*2, 0, Math.PI*0.52), mDurag);
    cap.position.y = 1.30;
    g.add(cap);
    // Durag band (horizontal strip)
    var bandRing = mk(new THREE.TorusGeometry(0.36, 0.035, 8, 22), mDurag);
    bandRing.rotation.x = Math.PI / 2;
    bandRing.position.y = 1.20;
    g.add(bandRing);
    // Gold aviator frames
    [-0.14, 0.14].forEach(function (lx) {
      var lens = mk(new THREE.TorusGeometry(0.085, 0.018, 8, 16), mGold);
      lens.rotation.x = Math.PI / 2;
      lens.position.set(lx, 1.32, 0.36);
      g.add(lens);
      var fill = mk(new THREE.CircleGeometry(0.075, 14), mat(0xffee88, {transparent:true, opacity:0.45}));
      fill.position.set(lx, 1.32, 0.37);
      g.add(fill);
    });
    // Bridge between lenses
    var bridge = mk(new THREE.CapsuleGeometry(0.012, 0.08, 4, 8), mGold);
    bridge.rotation.z = Math.PI / 2;
    bridge.position.set(0, 1.32, 0.36);
    g.add(bridge);
    // Goatee
    var mGoatee = mat(0x1a0e04);
    var goatee = mk(new THREE.SphereGeometry(0.085, 10, 8), mGoatee);
    goatee.scale.set(0.9, 1.2, 0.55);
    goatee.position.set(0, 1.12, 0.37);
    g.add(goatee);
    // Eyes
    var mEyeW = mat(0xf0f0f0); var mPupil = mat(0x111111);
    [-0.14, 0.14].forEach(function (ex) {
      var ew = mk(new THREE.SphereGeometry(0.070, 10, 8), mEyeW); ew.position.set(ex, 1.36, 0.34); g.add(ew);
      var ep = mk(new THREE.SphereGeometry(0.040, 8, 6), mPupil); ep.position.set(ex, 1.36, 0.37); g.add(ep);
    });
    // Dreads hanging from back of head
    var dreadPositions = [[-0.22,1.10,-0.28],[-0.12,1.05,-0.35],[0,1.00,-0.38],[0.12,1.05,-0.35],[0.22,1.10,-0.28]];
    dreadPositions.forEach(function (dp) {
      var dread = limb(0.04, 0.03, 0.45 + Math.random()*0.15, mDread, 8);
      dread.position.set(dp[0], dp[1], dp[2]);
      dread.rotation.z = (Math.random()-0.5)*0.2;
      g.add(dread);
    });

    // TORSO
    var torso = latheTorso([
      [0.18,-0.42],[0.26,-0.10],[0.30,0.20],[0.28,0.46],[0.18,0.64],
    ], mJacket, 18);
    torso.position.y = 0.28;
    g.add(torso);
    // Gold chain
    for (var ci2 = 0; ci2 <= 10; ci2++) {
      var a2 = ci2 / 10 * Math.PI;
      var lk2 = mk(new THREE.TorusGeometry(0.028, 0.012, 6, 10), mGold);
      lk2.position.set(Math.cos(Math.PI-a2)*0.24, 0.66-Math.sin(a2)*0.12, 0.28);
      lk2.rotation.z = a2;
      lk2.rotation.x = (ci2 % 2 === 0) ? Math.PI/2 : 0;
      lk2.scale.set(1, 1.4, 1);
      g.add(lk2);
    }
    // LEGS
    [-0.18, 0.18].forEach(function (lx) {
      var leg = limb(0.12, 0.10, 0.72, mat(0x1a2535), 12);
      leg.position.set(lx, -0.62, 0);
      g.add(leg);
    });
    // ARMS
    [-0.34, 0.34].forEach(function (ax) {
      var arm = limb(0.10, 0.085, 0.55, mJacket, 10);
      arm.position.set(ax, 0.55, 0);
      g.add(arm);
    });
    // Shoes
    [-0.18, 0.18].forEach(function (sx) {
      var shoe = mk(new THREE.CapsuleGeometry(0.11, 0.20, 6, 12), mat(0x111111));
      shoe.rotation.z = Math.PI / 2;
      shoe.position.set(sx, -1.02, 0.06);
      g.add(shoe);
    });

    return g;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  MIC FLEX (First Durag Ceremony level) — isometric playable character
  //  Black hoodie body, light skin, sunglasses, dark-red pants, black shoes,
  //  blue shotgun ("Shotdipe"). Distinct from characterMicFlex() above (a
  //  different, larger version used elsewhere). The game tints this
  //  character's main body mesh from black toward red as a "rage" gauge, so
  //  the torso piece is exposed via userData.bodyMesh exactly like the
  //  original — same mechanic, smoother shapes.
  // ─────────────────────────────────────────────────────────────────────────
  function characterMicFlexDurag() {
    var g = new THREE.Group();

    var bodyM  = mat(0x111111, {roughness:0.6});
    var headM  = mat(0xffd0a0);
    var hairM  = mat(0xc8a060);
    var glassM = mat(0x000000, {roughness:0.3});
    var pantM  = mat(0x7a1a1a);
    var shoeM  = mat(0x080808);
    var soleM  = mat(0x333333);
    var gunM   = mat(0x4488ff, {roughness:0.4});
    var barrelM= mat(0x2266cc, {roughness:0.35});
    var gripM  = mat(0x1144aa);

    // Body — lathe torso (bodyMesh for rage-gauge tint)
    var body = latheTorso([
      [0.20,-0.42],[0.30,-0.18],[0.35,0.10],[0.34,0.30],[0.24,0.44],
    ], bodyM, 16);
    body.position.y = 0.42;
    g.add(body);

    // Arms — proper capsule limbs so they're visible
    [-0.38, 0.38].forEach(function(ax) {
      var arm = limb(0.10, 0.09, 0.50, bodyM, 10);
      arm.position.set(ax, 0.50, 0);
      g.add(arm);
    });

    // Head — smooth sphere
    var head = smoothHead(0.27, headM);
    head.position.y = 1.14;
    g.add(head);

    // Hair — rounded cap
    var hair = mk(new THREE.SphereGeometry(0.28, 14, 10, 0, Math.PI*2, 0, Math.PI*0.45), hairM);
    hair.position.y = 1.32;
    g.add(hair);

    // Sunglasses — thin horizontal bar
    var glasses = mk(new THREE.CapsuleGeometry(0.022, 0.30, 4, 8), glassM);
    glasses.rotation.z = Math.PI / 2;
    glasses.position.set(0, 1.12, 0.26);
    g.add(glasses);

    // Pants — chunky capsule legs, clearly visible
    [-0.17, 0.17].forEach(function (lx) {
      var leg = limb(0.13, 0.12, 0.52, pantM, 12);
      leg.position.set(lx, -0.14, 0);
      g.add(leg);
    });

    // Shoes — Z-forward capsule (points forward, not sideways)
    [-0.17, 0.17].forEach(function (sx) {
      var shoe = mk(new THREE.CapsuleGeometry(0.10, 0.24, 6, 10), shoeM);
      // No rotation — capsule default is Y-axis; rotate to X so it lies flat along Z
      shoe.rotation.x = Math.PI / 2;
      shoe.position.set(sx, -0.44, 0.06);
      g.add(shoe);
      var sole = mk(new THREE.CylinderGeometry(0.10, 0.10, 0.04, 10), soleM);
      sole.rotation.x = Math.PI / 2;
      sole.position.set(sx, -0.50, 0.06);
      g.add(sole);
    });

    // Shotdipe — sawn-off shotgun, Z-forward (points toward camera/forward)
    // Body — wide receiver block
    var gunBody = mk(new THREE.CapsuleGeometry(0.07, 0.26, 6, 10), gunM);
    // Stand upright, then tilt forward — so barrel points along Z
    gunBody.rotation.x = Math.PI / 2;
    gunBody.position.set(0.40, 0.45, 0.22);
    g.add(gunBody);

    // Dual barrels — two slim capsules side by side, pointing forward
    [-0.035, 0.035].forEach(function(bx) {
      var bar = mk(new THREE.CapsuleGeometry(0.025, 0.36, 4, 8), barrelM);
      bar.rotation.x = Math.PI / 2;
      bar.position.set(0.40 + bx, 0.52, 0.44);
      g.add(bar);
    });

    // Grip — pointing slightly down
    var grip = mk(new THREE.CapsuleGeometry(0.035, 0.15, 4, 8), gripM);
    grip.rotation.x = 0.35;
    grip.position.set(0.40, 0.30, 0.18);
    g.add(grip);

    g.userData.bodyMesh = body;
    g.userData.headMesh = head;
    return g;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  DURAG DADA (First Durag Ceremony level) — isometric "rage" character
  //  Black robe with green leaf-pattern tint, dark skin, navy durag with
  //  tail, six dreads. Distinct from characterDuragDada() above (a larger,
  //  more detailed version used elsewhere).
  // ─────────────────────────────────────────────────────────────────────────
  function characterDuragDadaDurag() {
    var g = new THREE.Group();

    var robeM  = mat(0x0a1a0a);
    var leafM  = mat(0x2d7a2d);
    var headM  = mat(0x6b3a1f);
    var duragM = mat(0x0a0a2a);
    var dreadM = mat(0x0d0d0d);

    // Robe — lathe torso instead of a plain box
    var robe = latheTorso([
      [0.24,-0.30],[0.34,-0.05],[0.42,0.25],[0.40,0.55],[0.26,0.78],
    ], robeM, 18);
    robe.position.y = 0.25;
    g.add(robe);

    // Leaf-pattern spots — small rounded discs instead of flat boxes
    [[0.3,0.5,0.26],[-0.3,0.2,0.26],[0.1,0.0,0.26],[-0.2,0.7,0.26]].forEach(function (p) {
      var spot = mk(new THREE.SphereGeometry(0.075, 8, 6), leafM);
      spot.scale.set(1, 1.3, 0.4);
      spot.position.set(p[0], p[1], p[2]);
      g.add(spot);
    });

    // Head — smooth sphere
    var head = smoothHead(0.30, headM);
    head.position.y = 1.22;
    g.add(head);

    // Durag — rounded cap instead of box
    var durag = mk(new THREE.SphereGeometry(0.31, 14, 10, 0, Math.PI*2, 0, Math.PI*0.5), duragM);
    durag.position.y = 1.46;
    g.add(durag);
    // Durag tail
    var tail = mk(new THREE.CapsuleGeometry(0.04, 0.32, 4, 8), duragM);
    tail.position.set(0, 1.3, -0.28);
    g.add(tail);

    // Dreads — smooth tapered capsule strands
    for (var d = 0; d < 6; d++) {
      var dread = limb(0.035, 0.025, 0.46, dreadM, 8);
      dread.position.set((d % 3 - 1) * 0.2, 1.0 - d * 0.04, (d < 3 ? -0.26 : -0.18));
      g.add(dread);
    }

    g.userData.bodyMesh = robe;
    g.userData.headMesh = head;
    return g;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  DURAG STOOGE (First Durag Ceremony level) — koopa-style ground enemy
  //  Big head + two feet, no torso/arms (matches the other levels' stooges).
  //  type cycles 0=Moe,1=Larry,2=Curly; foot color set by hp tier.
  // ─────────────────────────────────────────────────────────────────────────
  function enemyDuragStooge(type, hp) {
    type = type || 0;
    var g = new THREE.Group();

    var mSkin  = mat(0xf5c8a0);
    var mEyeW  = mat(0xffffff);
    var mPupil = mat(0x111111);
    var mBrow  = mat(0x4a2800);
    var mMouth = mat(0x991111);
    var mHair  = mat(type === 2 ? 0xf5c8a0 : 0x1a1a1a);
    var tCol   = hp === 1 ? 0x44aa44 : (hp === 2 ? 0x3355dd : 0xaa33cc);
    var tEmit  = hp === 1 ? 0x112211 : (hp === 2 ? 0x112244 : 0x330844);
    var mFoot  = mat(tCol, {emissive: tEmit, emissiveIntensity: 0.4});

    // Big sphere head sitting near the ground
    var head = smoothHead(0.52, mSkin, 1, 1.08, 1);
    head.position.y = 0.58;
    g.add(head);
    g.userData.bodyMesh = head; // for hit flash

    var nose = mk(new THREE.SphereGeometry(0.11, 10, 8), mSkin);
    nose.scale.set(1, 0.75, 0.8);
    nose.position.set(0, 0.60, 0.50);
    g.add(nose);

    [-0.20, 0.20].forEach(function (ex) {
      var ew = mk(new THREE.SphereGeometry(0.10, 10, 8), mEyeW); ew.position.set(ex, 0.74, 0.44); g.add(ew);
      var ep = mk(new THREE.SphereGeometry(0.05, 8, 6), mPupil); ep.position.set(ex, 0.74, 0.53); g.add(ep);
      var br = mk(new THREE.CapsuleGeometry(0.022, 0.12, 4, 8), mBrow);
      br.rotation.z = ex < 0 ? 0.45 : -0.45;
      br.rotation.y = Math.PI / 2;
      br.position.set(ex, 0.90, 0.46);
      g.add(br);
    });

    var mouth = mk(new THREE.CapsuleGeometry(0.025, 0.22, 4, 8), mMouth);
    mouth.rotation.z = Math.PI / 2;
    mouth.position.set(0, 0.40, 0.50);
    g.add(mouth);

    [-0.52, 0.52].forEach(function (ex) {
      var ear = mk(new THREE.SphereGeometry(0.10, 10, 8), mSkin);
      ear.scale.set(0.5, 0.7, 0.5);
      ear.position.set(ex, 0.58, 0);
      g.add(ear);
    });

    if (type === 0) {
      var bowl = mk(new THREE.SphereGeometry(0.46, 16, 8, 0, Math.PI*2, 0, Math.PI*0.45), mHair);
      bowl.position.y = 0.68;
      g.add(bowl);
      var fringe = mk(new THREE.CapsuleGeometry(0.049, 0.63, 6, 10), mHair);
      fringe.rotation.z = Math.PI / 2;
      fringe.position.set(0, 0.86, 0.42);
      g.add(fringe);
      [-0.40, 0.40].forEach(function (sx) {
        var side = limb(0.06, 0.06, 0.30, mHair, 8);
        side.position.set(sx, 0.58, 0.09);
        g.add(side);
      });
    } else if (type === 1) {
      var baldTop = mk(new THREE.SphereGeometry(0.45, 14, 8, 0, Math.PI*2, 0, Math.PI*0.3), mSkin);
      baldTop.position.y = 0.80;
      g.add(baldTop);
      [[-0.50,0.58,-0.05],[0.50,0.58,-0.05],[-0.36,0.48,-0.38],[0.36,0.48,-0.38]].forEach(function (p) {
        var puff = mk(new THREE.SphereGeometry(0.15 + Math.random()*0.05, 10, 8), mHair);
        puff.position.set(p[0], p[1], p[2]);
        g.add(puff);
      });
    } else {
      var mStubble = mat(0xaaaaaa);
      var ring = mk(new THREE.TorusGeometry(0.44, 0.04, 8, 18), mStubble);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.78;
      g.add(ring);
    }

    // Two feet directly under the head
    [-0.22, 0.22].forEach(function (fx) {
      var foot = mk(new THREE.SphereGeometry(0.15, 10, 8), mFoot);
      foot.position.set(fx, 0.04, 0);
      g.add(foot);
    });

    return g;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  DIPE GENIE — hero ally
  //  Red beard / rope necklaces / blue cape / tunic / lamp prop
  // ─────────────────────────────────────────────────────────────────────────
// (characterDipeGenie draft removed V13.7.0 — superseded by the live design below)
  function _birdBase(bodyColor, beakColor, eyeColor) {
    var g = new THREE.Group();

    var mBody = mat(bodyColor || 0x664422);
    var mBeak = mat(beakColor || 0xffcc00);
    var mEye  = mat(eyeColor  || 0xffffff);
    var mPupil= mat(0x111111);

    // BODY — smooth round blob
    var body = mk(new THREE.SphereGeometry(0.52, 20, 16), mBody);
    body.scale.set(1, 1.15, 0.95);
    body.position.y = 0;
    g.add(body);

    // HEAD — smaller sphere on top-front of body
    var head = smoothHead(0.32, mBody);
    head.position.set(0, 0.55, 0.18);
    g.add(head);

    // BEAK — tapered cone
    var beak = mk(new THREE.ConeGeometry(0.10, 0.30, 12), mBeak);
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 0.56, 0.54);
    g.add(beak);

    // Eyes
    [-0.16, 0.16].forEach(function (ex) {
      var ew = mk(new THREE.SphereGeometry(0.085, 12, 10), mEye); ew.position.set(ex, 0.64, 0.45); g.add(ew);
      var ep = mk(new THREE.SphereGeometry(0.048, 10, 8), mPupil); ep.position.set(ex, 0.64, 0.52); g.add(ep);
    });

    // LEGS (bird talons)
    [-0.20, 0.20].forEach(function (lx) {
      var leg = limb(0.065, 0.050, 0.32, mat(0xd4a06a), 8);
      leg.position.set(lx, -0.52, 0);
      g.add(leg);
      // Three-toe foot
      [0, -0.18, 0.18].forEach(function (tz) {
        var toe = limb(0.025, 0.018, 0.14, mat(0xd4a06a), 6);
        toe.rotation.x = Math.PI / 2;
        toe.rotation.y = tz === 0 ? 0 : (tz < 0 ? 0.45 : -0.45);
        toe.position.set(lx, -0.72, tz + 0.06);
        g.add(toe);
      });
    });

    // WINGS — flat rounded panels on sides
    [-1, 1].forEach(function (side) {
      var wing = mk(new THREE.SphereGeometry(0.40, 14, 10), mBody);
      wing.scale.set(0.28, 0.55, 0.85);
      wing.position.set(side * 0.58, 0.10, -0.05);
      wing.rotation.z = side * 0.45;
      g.add(wing);
    });

    return { group: g, mBody: mBody };
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  OZTRICH — villain boss bird
  //  Cream crest / up-beak / pink wattle / green scarf / yellow tie / wings
  // ─────────────────────────────────────────────────────────────────────────
  function enemyOztrich() {
    var base = _birdBase(0xd4c8a0, 0xffcc00, 0xffffff);  // cream body
    var g = base.group;
    // Cream crest on top of head
    var mCrest = mat(0xf0e8d0);
    [0, -0.08, 0.08].forEach(function (cx) {
      var cf = mk(new THREE.ConeGeometry(0.06, 0.22, 8), mCrest);
      cf.position.set(cx, 1.00, 0.14);
      g.add(cf);
    });
    // Pink wattle (under beak)
    var wattle = mk(new THREE.SphereGeometry(0.10, 10, 8), mat(0xff8899));
    wattle.scale.set(0.9, 1.2, 0.7);
    wattle.position.set(0, 0.42, 0.50);
    g.add(wattle);
    // Green scarf
    var mScarf = mat(0x228822);
    var scarf = mk(new THREE.TorusGeometry(0.30, 0.06, 8, 20), mScarf);
    scarf.rotation.x = Math.PI / 2;
    scarf.position.y = 0.20;
    g.add(scarf);
    // Yellow tie
    var mTie = mat(0xffee00);
    var tie = mk(new THREE.CapsuleGeometry(0.045, 0.32, 6, 10), mTie);
    tie.position.set(0, 0.04, 0.52);
    g.add(tie);
    return g;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  PIDGIN — villain bird
  //  Grey-cream feathers / top hat / polka-dot tie / cane / white wing-mantle
  // ─────────────────────────────────────────────────────────────────────────
  function enemyPidgin() {
    var base = _birdBase(0xccccbb, 0xd4d4c0, 0xffffff);  // grey-cream
    var g = base.group;
    // Top hat
    var mHat = mat(0x111111);
    var hatBrim = mk(new THREE.CylinderGeometry(0.38, 0.38, 0.06, 20), mHat);
    hatBrim.position.set(0, 1.05, 0.14);
    g.add(hatBrim);
    var hatTop = limb(0.24, 0.24, 0.45, mHat, 18);
    hatTop.position.set(0, 1.28, 0.14);
    g.add(hatTop);
    // Polka-dot tie
    var mTieP = mat(0xffffff);
    var tie2 = mk(new THREE.CapsuleGeometry(0.040, 0.28, 6, 10), mTieP);
    tie2.position.set(0, 0.04, 0.54);
    g.add(tie2);
    var mDot = mat(0x333333);
    [[0,0.10],[0,0],[0,-0.10]].forEach(function (d) {
      var dot = mk(new THREE.SphereGeometry(0.022, 6, 6), mDot);
      dot.position.set(d[0], 0.04+d[1], 0.56);
      g.add(dot);
    });
    // Cane (right side)
    var mCane = mat(0xd4a84b, {metalness:0.2});
    var cane = limb(0.022, 0.022, 0.65, mCane, 8);
    cane.rotation.z = 0.18;
    cane.position.set(0.60, -0.30, 0.20);
    g.add(cane);
    var caneTop = mk(new THREE.TorusGeometry(0.055, 0.018, 8, 14), mCane);
    caneTop.rotation.z = Math.PI / 2;
    caneTop.position.set(0.66, 0.06, 0.20);
    g.add(caneTop);
    // Feather mantle (layered round puffs)
    var mFeather = mat(0xe8e8d8);
    [[0,-0.05],[-0.40,-0.10],[0.40,-0.10],[-0.20,0.08],[0.20,0.08]].forEach(function (fp) {
      var puff = mk(new THREE.SphereGeometry(0.22, 12, 10), mFeather);
      puff.position.set(fp[0], fp[1], -0.25);
      g.add(puff);
    });
    return g;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  SEAGLE — villain bird
  //  Blue cowl / up-beak / layered wings / gold belt + emblem / cape
  // ─────────────────────────────────────────────────────────────────────────
  function enemySeagle() {
    var base = _birdBase(0x2244aa, 0xffee44, 0xffffff);  // blue body, yellow beak
    var g = base.group;
    // Blue cowl over head
    var mCowl = mat(0x1a3399);
    var cowl = mk(new THREE.SphereGeometry(0.36, 18, 12, 0, Math.PI*2, 0, Math.PI*0.52), mCowl);
    cowl.position.set(0, 0.55, 0.18);
    g.add(cowl);
    // Gold belt
    var mGold2 = mat(0xf0b800, {metalness:0.25, roughness:0.45});
    var belt = mk(new THREE.TorusGeometry(0.32, 0.045, 8, 22), mGold2);
    belt.rotation.x = Math.PI / 2;
    belt.position.y = -0.15;
    g.add(belt);
    // Belt emblem
    var emblem = mk(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 10), mGold2);
    emblem.position.set(0, -0.15, 0.34);
    g.add(emblem);
    // Cape
    var mCape2 = mat(0x112266);
    var cape2 = mk(new THREE.CapsuleGeometry(0.30, 0.70, 8, 14), mCape2);
    cape2.position.set(0, 0.0, -0.40);
    cape2.scale.set(1, 1, 0.22);
    g.add(cape2);
    return g;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  PIDGIN (Dipemobile Chase level) — grey vested mugger bird, top hat
  //  Distinct from enemyPidgin() above (a different, smaller flying-bird
  //  villain used elsewhere). This is the humanoid roadside chase enemy:
  //  grey body, dark vest, black gloves, orange bird feet, feather cape,
  //  top hat, skin-toned head. Same colors/outfit/scale as the original.
  // ─────────────────────────────────────────────────────────────────────────
  function enemyPidginChase() {
    var g = new THREE.Group();
    g.name = 'pidgin';

    var grey       = mat(0x5a5a5a, {roughness:0.8});
    var darkGrey   = mat(0x3a3a3a, {roughness:0.8});
    var black      = mat(0x111111, {roughness:0.6});
    var skin       = mat(0xd0a080);
    var orangeFoot = mat(0xff8c00);
    var feather    = mat(0xa0b0c0, {side: THREE.DoubleSide});
    var featherDark= mat(0x708090, {side: THREE.DoubleSide});

    // Body — smooth tapered capsule instead of low-poly cylinder
    var body = limb(0.45, 0.55, 1.3, grey, 16);
    body.position.y = 0.65;
    g.add(body);

    // Vest — kept as a soft rounded box so it still reads as a garment
    var vest = mk(new THREE.CapsuleGeometry(0.42, 0.55, 6, 12), darkGrey);
    vest.scale.set(1, 1, 0.72);
    vest.position.y = 0.7;
    g.add(vest);

    // Arms — smooth capsule limbs
    [-1, 1].forEach(function (side) {
      var shoulder = mk(new THREE.SphereGeometry(0.18, 12, 10), grey);
      shoulder.position.set(side*0.5, 1.1, 0);
      g.add(shoulder);
      var arm = limb(0.14, 0.16, 0.9, grey, 12);
      arm.position.set(side*0.65, 0.65, 0);
      arm.rotation.z = side * 0.3;
      g.add(arm);
      var glove = mk(new THREE.SphereGeometry(0.22, 12, 10), black);
      glove.position.set(side*0.78, 0.18, 0);
      g.add(glove);
    });

    // Legs — smooth capsule
    [-0.25, 0.25].forEach(function (lx) {
      var leg = limb(0.18, 0.22, 1.0, grey, 12);
      leg.position.set(lx, -0.45, 0);
      g.add(leg);
      // Bird foot — round base + smooth tapered toes
      var foot = mk(new THREE.SphereGeometry(0.25, 12, 10), orangeFoot);
      foot.scale.set(1, 0.7, 1.1);
      foot.position.set(lx, -1.05, 0.18);
      g.add(foot);
      for (var t=-1; t<=1; t++) {
        var toe = limb(0.055, 0.04, 0.24, orangeFoot, 8);
        toe.rotation.x = Math.PI/2;
        toe.position.set(lx + t*0.12, -1.20, 0.32);
        g.add(toe);
      }
    });

    // Feather cape — layered rounded plumes instead of flat planes
    for (var fi=0; fi<11; fi++) {
      var fcol = fi%2===0 ? feather : featherDark;
      var plume = mk(new THREE.SphereGeometry(0.22, 10, 8), fcol);
      plume.scale.set(0.55, 0.85, 0.22);
      plume.position.set((fi-5)*0.13, 0.95-fi*0.14, 0.48 + Math.random()*0.04);
      plume.rotation.y = (Math.random()-0.5)*0.4;
      g.add(plume);
    }

    // Head — smooth sphere
    var head = smoothHead(0.42, skin);
    head.position.y = 1.6;
    g.add(head);

    // Top hat — smooth cylinder brim + crown
    var hatBrim = mk(new THREE.CylinderGeometry(0.5, 0.55, 0.12, 18), black);
    hatBrim.position.y = 1.9;
    g.add(hatBrim);
    var hatTop = limb(0.32, 0.32, 0.5, black, 16);
    hatTop.position.y = 2.2;
    g.add(hatTop);

    // Eyes — black dots
    [-0.15, 0.15].forEach(function (ex) {
      var eye = mk(new THREE.SphereGeometry(0.10, 10, 8), black);
      eye.position.set(ex, 1.68, -0.35);
      g.add(eye);
    });
    // Mouth — thin rounded bar
    var mouth = mk(new THREE.CapsuleGeometry(0.018, 0.20, 4, 8), black);
    mouth.rotation.z = Math.PI/2;
    mouth.position.set(0, 1.45, -0.38);
    g.add(mouth);

    g.rotation.y = Math.PI;
    g.scale.setScalar(1.8);
    return g;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  SEAGLE (Dipemobile Chase level) — blue-suited seagull superhero
  //  White chest, silver cape, yellow beak, staff with seagull companion.
  //  Same colors/outfit/scale as the original.
  // ─────────────────────────────────────────────────────────────────────────
  function enemySeagleChase() {
    var g = new THREE.Group();
    g.name = 'seagle';

    var blue    = mat(0x1a4a8a, {roughness:0.6});
    var darkBlue= mat(0x0f2a5a);
    var white   = mat(0xf0f0f0, {roughness:0.5});
    var yellow  = mat(0xffd700, {roughness:0.45});
    var skin    = mat(0xd0a080);
    var orange  = mat(0xff6a00);
    var brown   = mat(0x8b4513);
    var silver  = mat(0xc0c0c0, {metalness:0.3, roughness:0.4, side: THREE.DoubleSide});
    var black   = mat(0x111111);

    // Body
    var body = limb(0.4, 0.5, 1.2, blue, 16);
    body.position.y = 0.6;
    g.add(body);

    // Chest emblem panel — rounded
    var chest = mk(new THREE.CapsuleGeometry(0.33, 0.36, 6, 12), white);
    chest.scale.set(1, 1, 0.65);
    chest.position.y = 0.7;
    g.add(chest);

    // Arms
    [-1, 1].forEach(function (side) {
      var shoulder = mk(new THREE.SphereGeometry(0.17, 12, 10), white);
      shoulder.position.set(side*0.48, 1.05, 0);
      g.add(shoulder);
      var arm = limb(0.14, 0.16, 0.9, white, 12);
      arm.position.set(side*0.62, 0.62, 0);
      arm.rotation.z = side * 0.25;
      g.add(arm);
      var glove = mk(new THREE.SphereGeometry(0.20, 12, 10), white);
      glove.position.set(side*0.75, 0.15, 0);
      g.add(glove);
    });

    // Legs
    [-0.22, 0.22].forEach(function (lx) {
      var leg = limb(0.17, 0.2, 1.0, blue, 12);
      leg.position.set(lx, -0.5, 0);
      g.add(leg);
      var foot = mk(new THREE.SphereGeometry(0.23, 12, 10), orange);
      foot.scale.set(1, 0.7, 1.1);
      foot.position.set(lx, -1.10, 0.18);
      g.add(foot);
      for (var t=-1; t<=1; t++) {
        var toe = limb(0.05, 0.035, 0.22, orange, 8);
        toe.rotation.x = Math.PI/2;
        toe.position.set(lx + t*0.10, -1.23, 0.30);
        g.add(toe);
      }
    });

    // Cape — silver, gently curved (rounded capsule sheet instead of flat plane)
    var cape = mk(new THREE.CapsuleGeometry(0.62, 1.1, 6, 14), silver);
    cape.scale.set(1, 1, 0.12);
    cape.position.set(0, 0.3, 0.42);
    g.add(cape);

    // Head + mask
    var head = smoothHead(0.4, skin);
    head.position.y = 1.5;
    g.add(head);
    var mask = mk(new THREE.SphereGeometry(0.41, 14, 10), white);
    mask.scale.set(1, 0.9, 0.9);
    mask.position.y = 1.5;
    g.add(mask);
    [-0.17, 0.17].forEach(function (ex) {
      var eye = mk(new THREE.SphereGeometry(0.11, 10, 8), darkBlue);
      eye.position.set(ex, 1.58, -0.35);
      g.add(eye);
    });
    var mouth = mk(new THREE.CapsuleGeometry(0.018, 0.16, 4, 8), black);
    mouth.rotation.z = Math.PI/2;
    mouth.position.set(0, 1.38, -0.38);
    g.add(mouth);
    // Beak — smooth cone
    var beak = mk(new THREE.ConeGeometry(0.22, 0.45, 14), yellow);
    beak.rotation.x = -Math.PI/2;
    beak.position.set(0, 1.45, -0.5);
    g.add(beak);

    // Staff with seagull companion on top
    var staff = limb(0.04, 0.04, 1.8, brown, 10);
    staff.position.set(-0.9, 0.5, 0);
    staff.rotation.z = 0.15;
    g.add(staff);
    var staffTop = mk(new THREE.SphereGeometry(0.08, 10, 8), yellow);
    staffTop.position.set(-0.95, 1.35, 0);
    g.add(staffTop);
    var birdBody = mk(new THREE.SphereGeometry(0.15, 10, 8), white);
    birdBody.position.set(0.55, 1.3, -0.2);
    g.add(birdBody);
    var birdHead = mk(new THREE.SphereGeometry(0.10, 10, 8), white);
    birdHead.position.set(0.55, 1.45, -0.25);
    g.add(birdHead);
    var birdBeak = mk(new THREE.ConeGeometry(0.04, 0.10, 8), yellow);
    birdBeak.rotation.x = -Math.PI/2;
    birdBeak.position.set(0.55, 1.43, -0.35);
    g.add(birdBeak);

    g.rotation.y = Math.PI;
    g.scale.setScalar(1.8);
    return g;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  OZTRICH (Dipemobile Chase level) — ostrich boss, sandstorm theme
  //  Brown body, dark-brown loose feathers, yellow talon feet, white domino
  //  mask, dark-brown head spikes, yellow tie, green collar/cuffs.
  //  Same colors/outfit/scale as the original.
  // ─────────────────────────────────────────────────────────────────────────
  function enemyOztrichChase() {
    var g = new THREE.Group();
    g.name = 'oztrich';

    var brown     = mat(0x7a5a3a, {roughness:0.75});
    var darkBrown = mat(0x5a3a2a, {roughness:0.8});
    var yellow    = mat(0xffd700, {roughness:0.45});
    var green     = mat(0x2a8a2a, {roughness:0.6});
    var skin      = mat(0xd0a080);
    var blue      = mat(0x1a4a8a);
    var white     = mat(0xf5f5f5, {roughness:0.5});
    var black     = mat(0x111111);

    // Body — raised so feet are visible, smooth capsule
    var body = limb(0.45, 0.55, 1.3, brown, 16);
    body.position.y = 0.85;
    g.add(body);

    // Loose feathers — rounded blobs instead of flat boxes
    for (var fi=0; fi<8; fi++) {
      var feather = mk(new THREE.SphereGeometry(0.16, 8, 6), darkBrown);
      feather.scale.set(1.1, 0.7, 0.4);
      feather.position.set((Math.random()-0.5)*0.7, 0.6+Math.random()*0.7, -0.32);
      feather.rotation.z = (Math.random()-0.5)*0.5;
      g.add(feather);
    }

    // Arms
    [-1, 1].forEach(function (side) {
      var shoulder = mk(new THREE.SphereGeometry(0.19, 12, 10), brown);
      shoulder.position.set(side*0.55, 1.35, 0);
      g.add(shoulder);
      var arm = limb(0.16, 0.18, 1.0, brown, 12);
      arm.position.set(side*0.7, 0.88, 0);
      arm.rotation.z = side * 0.25;
      g.add(arm);
      // Green cuff
      var cuff = mk(new THREE.TorusGeometry(0.20, 0.07, 8, 16), green);
      cuff.rotation.x = Math.PI/2;
      cuff.position.set(side*0.8, 0.35, 0);
      g.add(cuff);
    });

    // Legs — raised, smooth capsule
    [-0.26, 0.26].forEach(function (lx) {
      var leg = limb(0.19, 0.23, 1.1, brown, 12);
      leg.position.set(lx, -0.3, 0);
      g.add(leg);
      var foot = mk(new THREE.SphereGeometry(0.26, 12, 10), yellow);
      foot.scale.set(1, 0.7, 1.1);
      foot.position.set(lx, -0.90, 0.18);
      g.add(foot);
      for (var t=-1; t<=1; t++) {
        var toe = limb(0.06, 0.04, 0.26, yellow, 8);
        toe.rotation.x = Math.PI/2;
        toe.position.set(lx + t*0.13, -1.05, 0.33);
        g.add(toe);
      }
    });

    // Head + mask
    var head = smoothHead(0.44, skin);
    head.position.y = 1.85;
    g.add(head);
    // Head spikes — smooth narrow cones, slightly fewer/smaller for a cleaner silhouette
    for (var si=0; si<10; si++) {
      var sa = (si/10)*Math.PI*2;
      var spike = mk(new THREE.ConeGeometry(0.075, 0.26, 10), darkBrown);
      spike.position.set(Math.cos(sa)*0.42, 2.10, Math.sin(sa)*0.42);
      spike.lookAt(0, 2.40, 0);
      g.add(spike);
    }
    var mask = mk(new THREE.SphereGeometry(0.45, 14, 10), white);
    mask.scale.set(1, 0.85, 0.85);
    mask.position.y = 1.85;
    g.add(mask);
    [-0.19, 0.19].forEach(function (ex) {
      var eye = mk(new THREE.SphereGeometry(0.12, 10, 8), blue);
      eye.position.set(ex, 1.93, -0.38);
      g.add(eye);
    });
    var mouth = mk(new THREE.CapsuleGeometry(0.018, 0.18, 4, 8), black);
    mouth.rotation.z = Math.PI/2;
    mouth.position.set(0, 1.7, -0.4);
    g.add(mouth);
    // Beak
    var beak = mk(new THREE.ConeGeometry(0.24, 0.5, 14), yellow);
    beak.rotation.x = -Math.PI/2;
    beak.position.set(0, 1.75, -0.55);
    g.add(beak);
    // Tie
    var tie = mk(new THREE.CapsuleGeometry(0.08, 0.45, 4, 10), yellow);
    tie.position.set(0, 1.2, -0.33);
    g.add(tie);
    // Collar
    var collar = mk(new THREE.TorusGeometry(0.46, 0.10, 10, 20), green);
    collar.rotation.x = Math.PI/2;
    collar.position.y = 1.45;
    g.add(collar);

    g.rotation.y = Math.PI;
    g.scale.setScalar(1.75);
    return g;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  THE ROADSTUMBLER — boss 2
  //  Burly bird-hood / goggles / RR badge / exposed belly / yellow waders / beer
  // ─────────────────────────────────────────────────────────────────────────
  function enemyRoadstumbler() {
    var base = _birdBase(0x554422, 0xffaa00, 0xff6600);  // dark feather body, orange beak
    var g = base.group;

    // Larger scale overall (he's a big boss)
    g.scale.set(1.6, 1.6, 1.6);

    // Goggle band
    var mGoggle = mat(0x222222);
    var mLens   = mat(0xff6600, {transparent:true, opacity:0.6});
    var goggleBand = mk(new THREE.TorusGeometry(0.28, 0.04, 8, 20), mGoggle);
    goggleBand.position.set(0, 0.60, 0.20);
    g.add(goggleBand);
    [-0.14, 0.14].forEach(function (gx) {
      var lens = mk(new THREE.CylinderGeometry(0.085, 0.085, 0.04, 12), mLens);
      lens.rotation.x = Math.PI / 2;
      lens.position.set(gx, 0.60, 0.50);
      g.add(lens);
    });

    // RR badge on chest
    var mBadge = mat(0xcc2200);
    var badge = mk(new THREE.CylinderGeometry(0.10, 0.10, 0.04, 10), mBadge);
    badge.rotation.x = Math.PI / 2;
    badge.position.set(0, 0.15, 0.56);
    g.add(badge);

    // Exposed belly (lighter round sphere)
    var belly = mk(new THREE.SphereGeometry(0.35, 16, 14), mat(0xd4c09a));
    belly.scale.set(1, 0.85, 0.55);
    belly.position.set(0, -0.05, 0.42);
    g.add(belly);

    // Yellow waders (over-legs colour swap)
    var mWaders = mat(0xffdd00);
    [-0.20, 0.20].forEach(function (lx) {
      var wader = limb(0.14, 0.11, 0.50, mWaders, 12);
      wader.position.set(lx, -0.55, 0);
      g.add(wader);
    });

    // Beer can (right hand)
    var mCan = mat(0xdddd22);
    var can = limb(0.065, 0.065, 0.18, mCan, 10);
    can.position.set(0.66, 0.05, 0.28);
    g.add(can);
    var canTop = mk(new THREE.CylinderGeometry(0.065, 0.065, 0.035, 10), mat(0xaaaaaa));
    canTop.position.set(0.66, 0.15, 0.28);
    g.add(canTop);

    return g;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  ROADSTUMBLER BOSS — the actual desert boss-fight character
  //  (distinct from the small enemyRoadstumbler() bird-villain above — this is
  //  the big arena boss: blue hoodie, exposed belly, RR logo, yellow cargo
  //  pants, knee pads, beer bottle. Same colors/outfit/proportions as the
  //  original blocky model, rebuilt with smooth capsules/spheres/lathe.)
  //  Caller (buildRoadstumbler in the game) does whole-group position/rotation
  //  only — no named child references — so internal structure is free to change.
  // ─────────────────────────────────────────────────────────────────────────
  function enemyRoadstumblerBoss() {
    var g = new THREE.Group();

    var blue      = mat(0x0a2a5a);
    var blueDark  = mat(0x051a3a);
    var blueFuzzy = mat(0x1a3a6a);
    var yellow    = mat(0xffcc00, {roughness:0.55});
    var yellowDark= mat(0xcc9900);
    var skin      = mat(0xe8b080);
    var black     = mat(0x000000);
    var white     = mat(0xffffff, {roughness:0.4});
    var beakYellow= mat(0xffee00, {roughness:0.4});
    var brown     = mat(0x6b3510);
    var silver    = mat(0xe0e0e0, {metalness:0.35, roughness:0.3});
    var red       = mat(0xcc0000);

    // ── TORSO — lathe-revolved hoodie silhouette instead of a plain cylinder ──
    var torso = latheTorso([
      [0.62,1.10],[0.95,1.35],[1.05,1.65],[1.08,2.05],[1.0,2.40],[0.78,2.55],
    ], blue, 22);
    g.add(torso);

    // Zipper
    var zipper = mk(new THREE.CapsuleGeometry(0.022,1.2,4,8), silver);
    zipper.position.set(0,1.8,0.91);
    g.add(zipper);
    var zipPull = mk(new THREE.SphereGeometry(0.05,8,6), silver);
    zipPull.position.set(0,2.3,0.95);
    g.add(zipPull);

    // Exposed belly — smooth sphere
    var belly = mk(new THREE.SphereGeometry(0.85,18,14), skin);
    belly.position.y = 1.1; belly.scale.set(1,0.7,0.78);
    g.add(belly);
    var navel = mk(new THREE.SphereGeometry(0.045,8,6), black);
    navel.scale.set(1,1,0.4);
    navel.position.set(0,1.0,0.87);
    g.add(navel);

    // Belt
    var belt = mk(new THREE.TorusGeometry(0.9,0.08,10,22), brown);
    belt.position.y = 1.15; belt.rotation.x = Math.PI/2;
    g.add(belt);
    var buckle = mk(new THREE.CapsuleGeometry(0.06,0.10,4,8), silver);
    buckle.rotation.z = Math.PI/2;
    buckle.position.set(0,1.15,0.92);
    g.add(buckle);

    // Hoodie pocket
    var pocket = mk(new THREE.CapsuleGeometry(0.22,0.36,4,10), blueDark);
    pocket.scale.set(1.35,1,0.45);
    pocket.position.set(0,1.9,0.91);
    g.add(pocket);
    for (var i=0;i<3;i++){
      var stitch = mk(new THREE.CapsuleGeometry(0.01,0.46,3,6), black);
      stitch.rotation.z = Math.PI/2;
      stitch.position.set(0,1.75+i*0.15,0.92);
      g.add(stitch);
    }

    // RR logo patch
    var logoBg = mk(new THREE.CylinderGeometry(0.22,0.22,0.02,18), white);
    logoBg.rotation.x = Math.PI/2;
    logoBg.position.set(0.35,2.3,0.92);
    g.add(logoBg);
    var logoRing = mk(new THREE.TorusGeometry(0.175,0.025,8,18), black);
    logoRing.position.set(0.35,2.3,0.935);
    g.add(logoRing);
    [[0.28,2.32],[0.42,2.32]].forEach(function(lp){
      var rr = mk(new THREE.TorusGeometry(0.06,0.018,8,14,Math.PI), black);
      rr.rotation.z = Math.PI/2;
      rr.position.set(lp[0],lp[1],0.94);
      g.add(rr);
      var rrLeg = mk(new THREE.CapsuleGeometry(0.012,0.08,3,6), black);
      rrLeg.position.set(lp[0],lp[1]-0.07,0.94);
      g.add(rrLeg);
    });

    // Hood (rounded, with drawstrings)
    var hood = mk(new THREE.SphereGeometry(0.75,18,14), blue);
    hood.position.y = 3.0; hood.scale.y = 0.9;
    g.add(hood);
    [-0.3,0.3].forEach(function(sx, idx){
      var str2 = mk(new THREE.CapsuleGeometry(0.015,0.45,4,8), white);
      str2.rotation.z = idx===0 ? 0.2 : -0.2;
      str2.position.set(sx,2.7,0.7);
      g.add(str2);
      var aglet = mk(new THREE.CapsuleGeometry(0.02,0.07,4,6), silver);
      aglet.position.set(sx*1.17,2.45,0.72);
      g.add(aglet);
    });
    // Fuzzy collar — rounded blobs instead of cones
    for (var fc=0; fc<14; fc++){
      var ang = (fc/14)*Math.PI*2;
      var fuzz = mk(new THREE.SphereGeometry(0.13,8,6), blueFuzzy);
      fuzz.scale.set(0.7,0.7,1.2);
      fuzz.position.set(Math.cos(ang)*0.72, 2.6+Math.sin(fc*0.8)*0.08, Math.sin(ang)*0.72);
      fuzz.lookAt(0,2.6,0);
      g.add(fuzz);
    }

    // ── HEAD ──────────────────────────────────────────────────────────────
    var head = smoothHead(0.5, skin);
    head.position.y = 3.1;
    g.add(head);

    // Large beak — smooth cone with rounded tip
    var beak = mk(new THREE.ConeGeometry(0.28,0.60,16), beakYellow);
    beak.rotation.x = Math.PI/2;
    beak.position.set(0,3.1,0.55);
    g.add(beak);
    var beakTip = mk(new THREE.SphereGeometry(0.07,10,8), beakYellow);
    beakTip.position.set(0,3.1,0.85);
    g.add(beakTip);
    [-0.08,0.08].forEach(function(nx){
      var nostril = mk(new THREE.SphereGeometry(0.028,6,6), black);
      nostril.position.set(nx,3.12,0.75);
      g.add(nostril);
    });
    var beakHi = mk(new THREE.ConeGeometry(0.09,0.28,12), white);
    beakHi.rotation.x = Math.PI/2;
    beakHi.position.set(-0.08,3.15,0.62);
    g.add(beakHi);

    // Googly eyes
    [-0.22,0.22].forEach(function(ex){
      var eye = mk(new THREE.SphereGeometry(0.15,14,12), white);
      eye.position.set(ex,3.45,0.62);
      g.add(eye);
      var pupil = mk(new THREE.SphereGeometry(0.08,10,8), black);
      pupil.position.set(ex,3.45,0.74);
      g.add(pupil);
      var hi = mk(new THREE.SphereGeometry(0.03,6,6), white);
      hi.position.set(ex+(ex<0?0.03:0.03),3.48,0.78);
      g.add(hi);
      // Angry brow — rounded capsule
      var brow = mk(new THREE.CapsuleGeometry(0.022,0.18,4,8), black);
      brow.rotation.z = ex<0 ? 0.3 : -0.3;
      brow.rotation.y = Math.PI/2;
      brow.position.set(ex,3.6,0.65);
      g.add(brow);
    });

    // ── ARMS — smooth tapered capsule with fuzzy cuffs ──────────────────
    [-1,1].forEach(function(side){
      var arm = limb(0.28,0.32,1.6,blue,12);
      arm.position.set(side*1.3,1.9,0);
      arm.rotation.z = side*0.3;
      g.add(arm);
      for (var fz=0; fz<8; fz++){
        var a2 = (fz/8)*Math.PI*2;
        var fuzz2 = mk(new THREE.SphereGeometry(0.09,8,6), blueFuzzy);
        fuzz2.position.set(side*1.3+Math.cos(a2)*0.32, 1.9+Math.sin(a2)*0.7, Math.sin(a2)*0.32);
        g.add(fuzz2);
      }
    });

    // Left hand
    var handL = mk(new THREE.SphereGeometry(0.25,14,10), skin);
    handL.position.set(-1.8,1.0,0);
    g.add(handL);

    // Beer bottle (right hand prop) — smooth lathe profile
    var bottle = latheTorso([
      [0,0],[0.08,0.05],[0.08,0.32],[0.065,0.41],[0.03,0.52],[0.034,0.61],
    ], brown, 14);
    bottle.position.set(1.8,1.0,0);
    g.add(bottle);
    var label = mk(new THREE.CylinderGeometry(0.082,0.082,0.2,12), red);
    label.position.set(1.8,1.0,0);
    g.add(label);
    var cap = mk(new THREE.CylinderGeometry(0.036,0.036,0.05,10), silver);
    cap.position.set(1.8,1.62,0);
    g.add(cap);

    var handR = mk(new THREE.SphereGeometry(0.25,14,10), skin);
    handR.position.set(1.8,0.7,0);
    g.add(handR);

    // ── LEGS — smooth tapered capsule, yellow cargo pants ────────────────
    [-0.45,0.45].forEach(function(lx){
      var leg = limb(0.35,0.40,1.3,yellow,14);
      leg.position.set(lx,0.2,0);
      g.add(leg);
      // Cargo pocket
      var pocketLeg = mk(new THREE.CapsuleGeometry(0.10,0.14,4,8), yellowDark);
      pocketLeg.scale.set(1.2,1,0.4);
      pocketLeg.position.set(lx,0.3,0.41);
      g.add(pocketLeg);
      // Knee pad — rounded dome instead of box
      var knee = mk(new THREE.SphereGeometry(0.27,12,10), yellowDark);
      knee.scale.set(1,0.75,1);
      knee.position.set(lx,-0.2,0.12);
      g.add(knee);
    });

    // ── BOOTS with laces ───────────────────────────────────────────────────
    [-0.45,0.45].forEach(function(bx){
      var boot = limb(0.38,0.45,0.8,yellow,14);
      boot.position.set(bx,-0.9,0);
      g.add(boot);
      var stripe = mk(new THREE.TorusGeometry(0.41,0.05,8,18), silver);
      stripe.rotation.x = Math.PI/2;
      stripe.position.set(bx,-0.9,0);
      g.add(stripe);
      for (var lc=0; lc<4; lc++){
        var lace = mk(new THREE.CapsuleGeometry(0.01,0.30,3,6), black);
        lace.rotation.z = Math.PI/2;
        lace.position.set(bx,-0.75-lc*0.1,0.39);
        g.add(lace);
      }
      // Foot — rounded instead of box
      var foot = mk(new THREE.SphereGeometry(0.30,12,10), yellowDark);
      foot.scale.set(1,0.55,1.55);
      foot.position.set(bx,-1.35,0.18);
      g.add(foot);
    });

    // Comic action lines (kept as thin capsules, same positions)
    for (var al=0; al<8; al++){
      var aAngle = (al/8)*Math.PI*2;
      var line = mk(new THREE.CapsuleGeometry(0.012,0.55,3,6), yellow);
      line.position.set(Math.cos(aAngle)*1.2, 3.1+Math.sin(aAngle)*1.2, -0.3);
      line.lookAt(0,3.1,-0.3);
      g.add(line);
    }

    return g;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  KAKAPOO — lime-green parrot villain (Frogger level)
  //  Green shaggy fur + big beak
  // ─────────────────────────────────────────────────────────────────────────
  function enemyKakapoo() {
    var base = _birdBase(0x44cc22, 0xffaa00, 0xffffff);  // lime-green
    var g = base.group;
    // Shaggy fur puffs
    var mFur = mat(0x33aa11);
    [[0,0.20,-0.30],[0.30,0,-0.10],[-0.30,0,-0.10],[0,-0.20,-0.28],[0,0.30,0.10]].forEach(function (fp) {
      var puff = mk(new THREE.SphereGeometry(0.22, 10, 8), mFur);
      puff.position.set(fp[0], fp[1], fp[2]);
      g.add(puff);
    });
    // Big parrot crest
    var mCrest2 = mat(0xffee00);
    [0,-0.10,0.10].forEach(function (cx) {
      var crestF = mk(new THREE.ConeGeometry(0.06, 0.25, 8), mCrest2);
      crestF.position.set(cx, 1.02, 0.12);
      g.add(crestF);
    });
    return g;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  POOTOO — large-eyed brown villain (Frogger level)
  //  Brown potoo suit / huge eyes / low-flier posture
  // ─────────────────────────────────────────────────────────────────────────
  function enemyPootoo() {
    var base = _birdBase(0x664422, 0xffcc66, 0xffee00);  // brown, yellow eyes
    var g = base.group;
    // Giant saucer eyes (yellow)
    var mBigEye = mat(0xffee44);
    var mBigPupil = mat(0x110800);
    [-0.20, 0.20].forEach(function (ex) {
      var ew = mk(new THREE.SphereGeometry(0.13, 14, 12), mBigEye); ew.position.set(ex, 0.68, 0.44); g.add(ew);
      var ep = mk(new THREE.SphereGeometry(0.075, 12, 10), mBigPupil); ep.position.set(ex, 0.68, 0.52); g.add(ep);
    });
    // Shaggy body fur
    var mFur2 = mat(0x4a3018);
    [[-0.30,0,-0.28],[0.30,0,-0.28],[0,0.15,-0.40],[0,-0.25,-0.22]].forEach(function (fp) {
      var puff = mk(new THREE.SphereGeometry(0.20, 10, 8), mFur2);
      puff.position.set(fp[0], fp[1], fp[2]);
      g.add(puff);
    });
    return g;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  GOBBLER — The Gobbler villain bird
  //  Turkey hood / red comb / teal blazer / big tail-fan
  // ─────────────────────────────────────────────────────────────────────────
  function enemyGobbler() {
    var base = _birdBase(0xaa7744, 0xffaa00, 0xffffff);  // tan turkey
    var g = base.group;
    // Red comb
    var mComb = mat(0xcc1100);
    [0, -0.10, 0.10].forEach(function (cx) {
      var comb = mk(new THREE.SphereGeometry(0.07, 10, 8), mComb);
      comb.position.set(cx, 1.02, 0.12);
      g.add(comb);
    });
    // Wattle
    var wattle2 = mk(new THREE.SphereGeometry(0.085, 10, 8), mComb);
    wattle2.scale.set(0.8, 1.3, 0.7);
    wattle2.position.set(0, 0.42, 0.50);
    g.add(wattle2);
    // Teal blazer
    var mBlazer = mat(0x229988);
    var blazer = latheTorso([[0.20,-0.42],[0.28,-0.12],[0.30,0.22],[0.24,0.50],[0.16,0.62]], mBlazer, 18);
    blazer.position.y = 0.28;
    g.add(blazer);
    // Tail fan — ring of thin flat petals
    var mFan = mat(0x885533);
    for (var fi = 0; fi < 7; fi++) {
      var fa = (fi / 7 - 0.5) * Math.PI * 0.9;
      var fan = mk(new THREE.CapsuleGeometry(0.04, 0.40, 6, 10), mFan);
      fan.rotation.z = fa;
      fan.position.set(Math.sin(fa)*0.12, -0.10 + Math.cos(fa)*0.14, -0.50);
      g.add(fan);
    }
    return g;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  DOODOO — DooDoo villain bird
  //  Shaggy dodo / dark fur all over
  // ─────────────────────────────────────────────────────────────────────────
  function enemyDooDoo() {
    var base = _birdBase(0x443322, 0xffcc55, 0xffffaa);
    var g = base.group;
    var mFur3 = mat(0x2a1e10);
    [[0,0.20,-0.32],[0.32,0,-0.14],[-0.32,0,-0.14],[0,-0.22,-0.25],
     [0.20,0.10,0.20],[-0.20,0.10,0.20]].forEach(function (fp) {
      var puff = mk(new THREE.SphereGeometry(0.24 + Math.random()*0.06, 10, 8), mFur3);
      puff.position.set(fp[0], fp[1], fp[2]);
      g.add(puff);
    });
    return g;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  DRDD — TOP-DOWN (Dipe City Crossing / frogger level)
  //  A simplified, readable-from-above version of DRDD: black cape, blue
  //  tracksuit, gold chains/medal, blue durag with white dipe-spots. Distinct
  //  from playerDRDD() above (the full 3rd-person version used elsewhere).
  //  Caller passes in the level's own cached material bank (_FM) so the
  //  exact same blues/golds/skin tones are reused — same colors, same scale.
  // ─────────────────────────────────────────────────────────────────────────
  function characterDRDDFrogTop(M) {
    var g = new THREE.Group();

    // Cape — kept as a soft curved sheet (still reads correctly from above)
    var cape = mk(new THREE.CapsuleGeometry(0.5, 0.7, 6, 12), M.cape);
    cape.scale.set(1, 1, 0.12);
    cape.rotation.x = -Math.PI/2.35;
    cape.position.set(0, 0.45, -0.55);
    g.add(cape);

    // Torso — smooth lathe instead of a plain box
    var torso = latheTorso([
      [0.30,0.18],[0.40,0.45],[0.42,0.65],[0.36,0.83],
    ], M.suit, 16);
    torso.position.y = 0.18;
    g.add(torso);

    // Dipe-token spots on suit
    var spots = [[-0.24,0.83,0.16],[0.24,0.83,0.16],[0,0.83,-0.06],
                 [-0.24,0.83,-0.20],[0.24,0.83,-0.20],
                 [-0.30,0.55,0.34],[0.30,0.55,0.34],[0,0.55,0.34]];
    spots.forEach(function (p) {
      var s = mk(new THREE.SphereGeometry(0.075, 8, 6), M.white);
      s.scale.set(1, 0.4, 1);
      s.position.set(p[0], p[1], p[2]);
      g.add(s);
    });

    // Gold chains
    [0.30, 0.40].forEach(function (r, i) {
      var ch = mk(new THREE.TorusGeometry(r, 0.045, 8, 18), M.gold);
      ch.rotation.x = Math.PI/2.1;
      ch.position.set(0, 0.74-i*0.05, 0.30+i*0.02);
      g.add(ch);
    });
    var medal = mk(new THREE.CylinderGeometry(0.11, 0.11, 0.05, 14), M.gold);
    medal.rotation.x = Math.PI/2;
    medal.position.set(0, 0.5, 0.40);
    g.add(medal);

    // Arms — smooth tapered capsule
    [-0.55, 0.55].forEach(function (x) {
      var a = limb(0.10, 0.11, 0.5, M.suitDk, 10);
      a.position.set(x, 0.45, 0.02);
      g.add(a);
    });

    // Head — smooth sphere
    var head = smoothHead(0.26, M.skin);
    head.position.set(0, 1.0, 0.04);
    g.add(head);
    // Face hint (front)
    [-0.12, 0.12].forEach(function (x) {
      var e = mk(new THREE.SphereGeometry(0.045, 8, 6), M.black);
      e.position.set(x, 1.02, 0.29);
      g.add(e);
    });

    // Durag — rounded cap instead of box
    var dTop = mk(new THREE.SphereGeometry(0.29, 14, 10, 0, Math.PI*2, 0, Math.PI*0.5), M.suit);
    dTop.position.set(0, 1.25, 0.0);
    g.add(dTop);
    var dBack = mk(new THREE.CapsuleGeometry(0.16, 0.18, 4, 10), M.suit);
    dBack.scale.set(1, 1, 0.5);
    dBack.position.set(0, 1.16, -0.26);
    g.add(dBack);
    var knot = mk(new THREE.SphereGeometry(0.10, 10, 8), M.suitDk);
    knot.position.set(0, 1.18, -0.40);
    g.add(knot);
    var tail = mk(new THREE.CapsuleGeometry(0.05, 0.20, 4, 8), M.suit);
    tail.position.set(0, 1.0, -0.46);
    tail.rotation.x = 0.5;
    g.add(tail);
    var dspots = [[-0.16,1.36,0.1],[0.16,1.36,0.1],[0,1.36,-0.12],[-0.16,1.36,-0.16],[0.16,1.36,-0.16]];
    dspots.forEach(function (p) {
      var s = mk(new THREE.SphereGeometry(0.05, 8, 6), M.white);
      s.scale.set(1, 0.3, 1);
      s.position.set(p[0], p[1], p[2]);
      g.add(s);
    });

    // Legs — smooth tapered capsule
    [-0.18, 0.18].forEach(function (x) {
      var l = limb(0.11, 0.12, 0.4, M.suitDk, 10);
      l.position.set(x, 0.0, 0.02);
      g.add(l);
    });

    g.scale.set(1.05, 1.05, 1.05);
    return g;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  KAKAPOO (Dipe City Crossing level) — flightless parrot-man villain
  //  Green body, lighter green belly, folded wings, human legs in green
  //  pants. Distinct from enemyKakapoo() above (a different, smaller flying
  //  version used elsewhere). Caller passes the level's own cached material
  //  bank (M) so the exact same greens/beak-tan are reused.
  // ─────────────────────────────────────────────────────────────────────────
  function enemyKakapooFrog(M, scaleUp) {
    var s = scaleUp || 1;
    var g = new THREE.Group();
    var bellyM = mat(0x86d36a);
    var legM   = mat(0x205020);

    var body = mk(new THREE.SphereGeometry(0.5, 14, 10), M.kakBody);
    body.scale.set(1, 0.85, 1.1);
    body.position.y = 0.55;
    g.add(body);

    var belly = mk(new THREE.SphereGeometry(0.34, 12, 10), bellyM);
    belly.position.set(0, 0.5, 0.34);
    belly.scale.set(1, 0.9, 0.6);
    g.add(belly);

    var head = smoothHead(0.30, M.kakBody);
    head.position.set(0, 0.95, 0.18);
    g.add(head);

    var beak = mk(new THREE.ConeGeometry(0.16, 0.32, 12), M.kakBeak);
    beak.rotation.x = Math.PI/2;
    beak.position.set(0, 0.92, 0.5);
    g.add(beak);

    // Facial disc feathers (kakapo trait) — smooth torus
    var disc = mk(new THREE.TorusGeometry(0.30, 0.06, 8, 18), M.kakDk);
    disc.rotation.x = Math.PI/2;
    disc.position.set(0, 0.95, 0.16);
    g.add(disc);

    [-0.13, 0.13].forEach(function (x) {
      var e = mk(new THREE.SphereGeometry(0.06, 8, 6), mat(0x101010));
      e.position.set(x, 1.0, 0.36);
      g.add(e);
    });

    // Wings (folded) — smooth tapered capsule instead of flat box
    [-0.46, 0.46].forEach(function (x) {
      var w = limb(0.08, 0.10, 0.45, M.kakDk, 10);
      w.rotation.z = Math.PI/2;
      w.position.set(x, 0.55, 0);
      g.add(w);
    });
    // Tail — smooth capsule
    var tail = mk(new THREE.CapsuleGeometry(0.18, 0.34, 6, 10), M.kakDk);
    tail.scale.set(1, 0.55, 1);
    tail.position.set(0, 0.5, -0.5);
    g.add(tail);

    // Human legs (man in a suit) — smooth tapered capsule
    [-0.15, 0.15].forEach(function (x) {
      var l = limb(0.07, 0.075, 0.36, legM, 10);
      l.position.set(x, 0.1, 0);
      g.add(l);
    });

    g.scale.set(s, s, s);
    g.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    return g;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  POOTOO (Dipe City Crossing level) — giant-eyed flying villain
  //  Brown body, huge yellow saucer eyes (visible from above), dark wings.
  //  Distinct from enemyPootoo() above (a different, smaller version used
  //  elsewhere). Caller passes the level's own cached material bank (M).
  // ─────────────────────────────────────────────────────────────────────────
  function enemyPootooFrog(M, scaleUp) {
    var s = scaleUp || 1;
    var g = new THREE.Group();

    var body = mk(new THREE.SphereGeometry(0.46, 14, 10), M.pooBody);
    body.scale.set(1, 0.8, 1.2);
    body.position.y = 0.6;
    g.add(body);

    var head = smoothHead(0.32, M.pooBody);
    head.position.set(0, 1.0, 0.12);
    g.add(head);

    // Huge potoo eyes (on top, facing up — visible from above)
    [-0.15, 0.15].forEach(function (x) {
      var ey = mk(new THREE.SphereGeometry(0.15, 14, 10), M.eyeY);
      ey.position.set(x, 1.2, 0.1);
      g.add(ey);
      var p = mk(new THREE.SphereGeometry(0.07, 10, 8), M.eyeBlk);
      p.position.set(x, 1.28, 0.18);
      g.add(p);
    });

    var beak = mk(new THREE.ConeGeometry(0.18, 0.3, 10), M.pooDk);
    beak.rotation.x = Math.PI/2;
    beak.position.set(0, 1.02, 0.42);
    g.add(beak);

    // Spread wings (flying) — smooth tapered capsule instead of flat box
    [-1, 1].forEach(function (d) {
      var w = limb(0.07, 0.10, 0.65, M.pooDk, 10);
      w.position.set(d*0.6, 0.7, -0.05);
      w.rotation.z = Math.PI/2;
      w.rotation.x = d*0.25;
      g.add(w);
    });
    var tail = mk(new THREE.CapsuleGeometry(0.15, 0.30, 6, 10), M.pooDk);
    tail.scale.set(1, 0.6, 1);
    tail.position.set(0, 0.62, -0.55);
    g.add(tail);

    g.scale.set(s, s, s);
    g.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
    return g;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  PROPS — environment / level decorations
  // ─────────────────────────────────────────────────────────────────────────

  /** Simple pine tree (L1 hub style) */
  function propPineTree() {
    var g = new THREE.Group();
    var mTrunk = mat(0x5c3a1e, {roughness:0.9});
    var trunkG = limb(0.20, 0.34, 2.2, mTrunk, 10);
    trunkG.position.y = 1.1;
    g.add(trunkG);
    // Canopy layers
    var greens = [0x2d7a2d, 0x38a038, 0x4cc44c];
    [[2.8,1.85],[3.9,1.42],[4.8,1.02]].forEach(function (pl, i) {
      var cone = mk(new THREE.ConeGeometry(pl[1], 1.5, 12), mat(greens[i], {roughness:0.85}));
      cone.position.y = pl[0];
      cone.rotation.y = Math.random() * Math.PI;
      cone.castShadow = true;
      g.add(cone);
    });
    var tip = mk(new THREE.ConeGeometry(0.55, 1.1, 10), mat(0x5cd85c, {roughness:0.85}));
    tip.position.y = 5.5;
    g.add(tip);
    return g;
  }

  /** Rock (L1 hub style) */
  function propRock(sizeScale) {
    sizeScale = sizeScale || 0.8;
    var mRock = mat(0x888992, {roughness:0.95, metalness:0.0});
    var r = mk(new THREE.DodecahedronGeometry(sizeScale * 0.7, 0), mRock);
    r.material.flatShading = true;
    r.scale.set(1 + (Math.random()-0.5)*0.22, 0.55 + Math.random()*0.14, 1 + (Math.random()-0.5)*0.22);
    r.position.y = sizeScale * 0.35;
    r.rotation.set(Math.random()*0.5, Math.random()*Math.PI, (Math.random()-0.5)*0.5);
    return r;
  }

  /** Bush (L1 hub style) */
  function propBush() {
    var bg = new THREE.Group();
    var blobs = [[0,0.5,0,0.55],[0.42,0.42,0.1,0.42],[-0.4,0.4,-0.1,0.4],[0.06,0.7,-0.05,0.34]];
    blobs.forEach(function (b, i) {
      var col = i % 2 ? 0x2a8a2a : 0x208020;
      var m = mk(new THREE.SphereGeometry(b[3], 12, 10), mat(col, {roughness:0.85}));
      m.position.set(b[0], b[1], b[2]);
      m.scale.y = 0.85;
      bg.add(m);
    });
    return bg;
  }

  /** Poop hazard (Frogger level) */
  function propPoop() {
    var g = new THREE.Group();
    var mPoop = mat(0x6b3a2a, {roughness:0.9});
    // Three rounded lumps stacked
    [[0,0.12,0,0.18],[0.06,0.32,0,0.14],[0,0.46,0,0.10]].forEach(function (p) {
      var lump = mk(new THREE.SphereGeometry(p[3], 12, 10), mPoop);
      lump.position.set(p[0], p[1], p[2]);
      g.add(lump);
    });
    // Flies (tiny spheres)
    var mFly = mat(0x111111);
    [[0.15,0.52,0.10],[-0.14,0.54,-0.08],[0.08,0.58,0.05]].forEach(function (fp) {
      var fly = mk(new THREE.SphereGeometry(0.025, 6, 6), mFly);
      fly.position.set(fp[0], fp[1], fp[2]);
      g.add(fly);
    });
    return g;
  }

  /** Frogger tree (park scenery) */
  function propFrogTree() {
    var g = propPineTree();
    g.scale.set(0.7, 0.85, 0.7);
    return g;
  }

  /** Frogger bush (park scenery) */
  function propFrogBush() {
    return propBush();
  }

  /** Lily pad (Frogger river) */
  function propLilyPad() {
    var g = new THREE.Group();
    var mPad = mat(0x228833, {roughness:0.8});
    var pad = mk(new THREE.CylinderGeometry(0.55, 0.55, 0.06, 18), mPad);
    pad.position.y = 0.03;
    g.add(pad);
    // Notch cut-out is just visual suggestion via a small white flower
    var mFlower = mat(0xffffff);
    var flower = mk(new THREE.SphereGeometry(0.10, 8, 8), mFlower);
    flower.scale.y = 0.5;
    flower.position.set(0.20, 0.10, 0.20);
    g.add(flower);
    return g;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  PUBLIC FACTORY API
  // ─────────────────────────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════
  //  V13.7.0 MIGRATIONS — these five builders moved verbatim from index.html
  //  (Phase 3b). Bodies are byte-for-byte the live in-game versions, including
  //  their local mk helpers, child add-order (moto wheel spin uses children[2]/
  //  [3]), named parts (fat stooge 'hpgem0'/'hpgem1'), and userData refs
  //  (dodo userData.bodyMesh) — so every animation/updater keeps working.
  // ═══════════════════════════════════════════════════════════════════════════

  /** Dipe Genie — THE approved live design (rust onesie, ginger beard, rope
   *  necklace, iridescent cape). Replaces an early unused draft that had a
   *  blue tunic + red beard and never matched the character. */
  function characterDipeGenie(){
  const g = new THREE.Group();
  const mk=(geo,mat)=>{const m=new THREE.Mesh(geo,mat);m.castShadow=true;return m;};

  // ── Materials ──────────────────────────────────────────────────────────
  const skin    = new THREE.MeshLambertMaterial({color:0xd4956a});
  const rust    = new THREE.MeshLambertMaterial({color:0xb8622a}); // brown/rust onesie
  const rustDk  = new THREE.MeshLambertMaterial({color:0x9a4e1e}); // darker rust
  const capeM   = new THREE.MeshLambertMaterial({color:0x4ab0d4,transparent:true,opacity:0.88,side:THREE.DoubleSide}); // iridescent blue cape
  const capeSh  = new THREE.MeshLambertMaterial({color:0x3a90b8,transparent:true,opacity:0.75,side:THREE.DoubleSide});
  const ropeM   = new THREE.MeshLambertMaterial({color:0xe8d5a0}); // cream rope necklace
  const goldM   = new THREE.MeshLambertMaterial({color:0xd4a000,emissive:new THREE.Color(0x3a2800),emissiveIntensity:0.6});
  const whiteM  = new THREE.MeshLambertMaterial({color:0xf0f0f0});
  const watchM  = new THREE.MeshLambertMaterial({color:0xfafafa});
  const hairM   = new THREE.MeshLambertMaterial({color:0xb05520}); // ginger
  const beardM  = new THREE.MeshLambertMaterial({color:0xb05520});
  const tattooM = new THREE.MeshLambertMaterial({color:0x223355,transparent:true,opacity:0.6});
  const printM  = new THREE.MeshLambertMaterial({color:0x5c9daa,transparent:true,opacity:0.8}); // bottle print

  // ── BIG BODY — heavy-set, round ───────────────────────────────────────
  const belly = mk(new THREE.SphereGeometry(0.72,12,10), rust);
  belly.scale.set(1.05,1.15,0.95); belly.position.y=0.15; g.add(belly);
  // Chest/upper body wider
  const chest = mk(new THREE.SphereGeometry(0.65,12,10), rust);
  chest.scale.set(1.10,0.90,0.90); chest.position.y=0.70; g.add(chest);
  // Button placket down front — capsule instead of box
  const placket = mk(new THREE.CapsuleGeometry(0.06,0.80,4,8), rustDk);
  placket.position.set(0,0.40,0.68); g.add(placket);
  for(let i=0;i<5;i++){
    const btn=mk(new THREE.SphereGeometry(0.028,8,6), new THREE.MeshLambertMaterial({color:0x8a4010}));
    btn.position.set(0,0.80-i*0.18,0.72); g.add(btn);
  }
  // Onesie bottle/genie pattern dots — small spheres instead of boxes
  const bottlePositions=[
    [0.38,0.55,0.60],[-0.38,0.55,0.60],[0.55,0.20,0.50],[-0.55,0.20,0.50],
    [0.30,0.10,0.68],[-0.30,0.10,0.68],[0.42,0.85,0.50],[-0.42,0.85,0.50],
  ];
  bottlePositions.forEach(([x,y,z])=>{
    const bp=mk(new THREE.SphereGeometry(0.055,8,6),printM);
    bp.scale.set(0.7,1.2,0.5); bp.position.set(x,y,z); g.add(bp);
  });

  // ── CAPE — wide iridescent blue, drapes off shoulders ─────────────────
  // Left cape panel — sweeping wide
  const capeLG = new THREE.BufferGeometry();
  const capeVerts = new Float32Array([
    // Front face of left cape panel
    -0.70, 0.82, 0.0,   -1.4, -1.0, -0.2,  -0.60, -1.0, 0.3,
    -0.70, 0.82, 0.0,   -0.60,-1.0, 0.3,   -0.40, 0.60, 0.35,
  ]);
  capeLG.setAttribute('position', new THREE.BufferAttribute(capeVerts, 3));
  capeLG.computeVertexNormals();
  const capeLeft=new THREE.Mesh(capeLG,capeM); capeLeft.castShadow=true; g.add(capeLeft);
  // Right cape panel
  const capeRG = new THREE.BufferGeometry();
  const capeVertsR = new Float32Array([
    0.70, 0.82, 0.0,   0.60, -1.0, 0.3,   1.4, -1.0, -0.2,
    0.70, 0.82, 0.0,   0.40,  0.60, 0.35,  0.60, -1.0, 0.3,
  ]);
  capeRG.setAttribute('position', new THREE.BufferAttribute(capeVertsR, 3));
  capeRG.computeVertexNormals();
  const capeRight=new THREE.Mesh(capeRG,capeM); capeRight.castShadow=true; g.add(capeRight);
  // Cape back panel — segmented rounded panels instead of flat box
  const capePanels=[0,-0.32,-0.60,-0.84];
  const capePanelW=[1.0,0.92,0.80,0.64];
  capePanels.forEach((py,i)=>{
    const cp=mk(new THREE.CapsuleGeometry(0.10,capePanelW[i],4,10),i%2===0?capeSh:capeM);
    cp.rotation.z=Math.PI/2; cp.scale.set(1,1,0.18+i*0.04);
    cp.position.set(0,py-0.15,-0.62-i*0.04); g.add(cp);
  });
  // Cape shoulder pieces — rounded spheres instead of boxes
  [-0.60,0.60].forEach(x=>{
    const sh=mk(new THREE.SphereGeometry(0.22,12,10),capeM);
    sh.scale.set(1.3,0.55,1.8); sh.position.set(x,0.76,0.0); g.add(sh);
  });

  // ── ARMS — short sleeves ───────────────────────────────────────────────
  const armG = new THREE.SphereGeometry(0.24,8,6);
  // Upper arms (inside sleeves)
  const laUp=mk(armG,rust); laUp.scale.set(1,1.4,1); laUp.position.set(-0.82,0.50,0.10); g.add(laUp);
  const raUp=mk(armG,rust); raUp.scale.set(1,1.4,1); raUp.position.set( 0.82,0.50,0.10); g.add(raUp);
  // Short sleeve cuffs
  [-0.82,0.82].forEach(x=>{
    const c=mk(new THREE.CylinderGeometry(0.26,0.28,0.12,8),rust);
    c.position.set(x,0.30,0.10); g.add(c);
  });
  // Forearms (exposed)
  const foreG=new THREE.SphereGeometry(0.20,8,6);
  const laFore=mk(foreG,skin); laFore.scale.set(1,1.6,1); laFore.position.set(-0.84,-0.05,0.10); g.add(laFore);
  const raFore=mk(foreG,skin); raFore.scale.set(1,1.6,1); raFore.position.set( 0.84,-0.05,0.10); g.add(raFore);
  // Tattoo patches on forearms — flat rounded discs instead of boxes
  [-0.85,0.85].forEach(x=>{
    const tat=mk(new THREE.CylinderGeometry(0.16,0.16,0.03,14),tattooM);
    tat.rotation.x=Math.PI/2; tat.position.set(x,-0.05,0.24); g.add(tat);
  });
  // Hands
  const handG=new THREE.SphereGeometry(0.18,8,6);
  const lHand=mk(handG,skin); lHand.scale.set(1.1,0.9,0.9); lHand.position.set(-0.84,-0.40,0.12); g.add(lHand);
  const rHand=mk(handG,skin); rHand.scale.set(1.1,0.9,0.9); rHand.position.set( 0.84,-0.40,0.12); g.add(rHand);
  // White wristbands (both wrists)
  const wbM=new THREE.MeshLambertMaterial({color:0xf8f8f8});
  const wbG=new THREE.CylinderGeometry(0.22,0.22,0.14,10);
  const wbL=mk(wbG,wbM); wbL.position.set(-0.84,-0.30,0.12); g.add(wbL);
  const wbR=mk(wbG,wbM); wbR.position.set( 0.84,-0.30,0.12); g.add(wbR);

  // ── ROPE NECKLACE — thick cream/ivory, multiple loops ─────────────────
  for(let loop=0;loop<4;loop++){
    const r=0.30+loop*0.045, dip=0.08+loop*0.035, yBase=0.82-loop*0.05;
    const segs=16;
    for(let i=0;i<segs;i++){
      const t=i/segs, angle=t*Math.PI;
      const rx=Math.cos(Math.PI-angle)*r;
      const ry=yBase-Math.sin(angle)*dip;
      const seg=mk(new THREE.SphereGeometry(0.038,6,4),ropeM);
      seg.position.set(rx,ry,0.62+loop*0.02); g.add(seg);
    }
  }
  // Gold medallion/brooch
  const medallion=mk(new THREE.CylinderGeometry(0.075,0.075,0.05,10),goldM);
  medallion.position.set(-0.05,0.52,0.72); g.add(medallion);
  const med2=mk(new THREE.CylinderGeometry(0.065,0.065,0.05,10),goldM);
  med2.position.set(0.08,0.46,0.72); g.add(med2);

  // ── LEGS — onesie, wide ────────────────────────────────────────────────
  const legG=new THREE.SphereGeometry(0.30,8,6);
  const ll=mk(legG,rust); ll.scale.set(1,1.8,1); ll.position.set(-0.28,-0.78,0.05); g.add(ll);
  const rl=mk(legG,rust); rl.scale.set(1,1.8,1); rl.position.set( 0.28,-0.78,0.05); g.add(rl);
  // Feet — smooth forward-pointing capsule instead of flat box
  const footMat=new THREE.MeshLambertMaterial({color:0x8a4010});
  [-0.28,0.28].forEach(x=>{
    const foot=mk(new THREE.CapsuleGeometry(0.10,0.32,6,10),footMat);
    foot.rotation.x=Math.PI/2; foot.position.set(x,-1.14,0.10); g.add(foot);
    const sole=mk(new THREE.CylinderGeometry(0.10,0.10,0.04,10),new THREE.MeshLambertMaterial({color:0x5a2a08}));
    sole.rotation.x=Math.PI/2; sole.position.set(x,-1.20,0.10); g.add(sole);
  });

  // ── HEAD — round, chubby ──────────────────────────────────────────────
  const head=mk(new THREE.SphereGeometry(0.56,12,10),skin);
  head.scale.set(1.05,1.0,1.0); head.position.y=1.26; g.add(head);
  // Chubby cheeks
  [-0.38,0.38].forEach(x=>{
    const ck=mk(new THREE.SphereGeometry(0.22,8,6),skin);
    ck.scale.set(1,0.80,0.80); ck.position.set(x,1.20,0.30); g.add(ck);
  });
  // Nose — large, round
  const nose=mk(new THREE.SphereGeometry(0.12,8,6),new THREE.MeshLambertMaterial({color:0xc07858}));
  nose.scale.set(1.1,0.8,0.9); nose.position.set(0,1.22,0.54); g.add(nose);
  // Eyes — small but happy (squinting smile)
  const eyeWhite=new THREE.MeshLambertMaterial({color:0xfafafa});
  const eyeGreen=new THREE.MeshLambertMaterial({color:0x4a7a3a});
  const pupilM=new THREE.MeshLambertMaterial({color:0x111111});
  [-0.20,0.20].forEach(x=>{
    const ew=mk(new THREE.SphereGeometry(0.12,12,10),eyeWhite); ew.scale.set(1.2,0.85,0.55); ew.position.set(x,1.32,0.52); g.add(ew);
    const ei=mk(new THREE.SphereGeometry(0.08,10,8),eyeGreen);  ei.scale.set(1,1,0.7);  ei.position.set(x,1.32,0.54); g.add(ei);
    const ep=mk(new THREE.SphereGeometry(0.048,8,6),pupilM);    ep.position.set(x,1.32,0.56); g.add(ep);
    // Glint
    const gl=mk(new THREE.SphereGeometry(0.018,6,5),eyeWhite);  gl.position.set(x+0.03,1.35,0.57); g.add(gl);
    // Laugh lines — thin capsules
    const ln=mk(new THREE.CapsuleGeometry(0.02,0.10,4,6),new THREE.MeshLambertMaterial({color:0xc07858}));
    ln.rotation.z=x<0?-0.5:0.5; ln.position.set(x<0?-0.30:0.30,1.22,0.52); g.add(ln);
  });
  // Big smile — capsule arc instead of box
  const smileM=new THREE.MeshLambertMaterial({color:0xffffff});
  const smile=mk(new THREE.CapsuleGeometry(0.045,0.34,4,8),smileM);
  smile.rotation.z=Math.PI/2; smile.position.set(0,1.10,0.54); g.add(smile);
  const lipBot=mk(new THREE.CapsuleGeometry(0.035,0.30,4,8),new THREE.MeshLambertMaterial({color:0xcc6655}));
  lipBot.rotation.z=Math.PI/2; lipBot.position.set(0,1.04,0.54); g.add(lipBot);
  // Big ginger beard — full, long ─────────────────────────────────────────
  // Main beard mass
  const bMass=mk(new THREE.SphereGeometry(0.44,10,8),beardM);
  bMass.scale.set(1.0,1.45,0.75); bMass.position.set(0,0.92,0.28); g.add(bMass);
  // Beard sides
  [-0.28,0.28].forEach(x=>{
    const bs=mk(new THREE.SphereGeometry(0.28,8,6),beardM);
    bs.scale.set(0.8,1.2,0.7); bs.position.set(x,1.02,0.24); g.add(bs);
  });
  // Moustache — smooth capsule instead of box
  const moustache=mk(new THREE.CapsuleGeometry(0.055,0.36,4,8),beardM);
  moustache.rotation.z=Math.PI/2; moustache.position.set(0,1.13,0.55); g.add(moustache);
  // Beard tip
  const bTip=mk(new THREE.SphereGeometry(0.18,10,8),beardM);
  bTip.scale.set(0.7,1.2,0.6); bTip.position.set(0,0.56,0.40); g.add(bTip);

  // ── WILD HAIR — tousled ginger ─────────────────────────────────────────
  // Main hair mass on top
  const hair=mk(new THREE.SphereGeometry(0.50,10,8),hairM);
  hair.scale.set(1.10,0.72,1.05); hair.position.set(0,1.76,0); g.add(hair);
  // Tousled strands — asymmetric clumps
  const hairClumps=[[-0.3,1.90,0.15],[0.35,1.88,-0.1],[0.0,1.95,0.0],[-0.15,1.85,-0.2],[0.25,1.82,0.20]];
  hairClumps.forEach(([x,y,z])=>{
    const hc=mk(new THREE.SphereGeometry(0.14+Math.random()*0.08,6,4),hairM);
    hc.scale.set(0.8+Math.random()*0.4,0.7+Math.random()*0.5,0.8);
    hc.position.set(x,y,z); g.add(hc);
  });
  // Sideburns connecting to beard — smooth capsules instead of boxes
  [-0.42,0.42].forEach(x=>{
    const sb=mk(new THREE.CapsuleGeometry(0.07,0.28,4,8),hairM);
    sb.position.set(x,1.18,0.18); g.add(sb);
  });

  // Invisible hs dummy (game loop spins it — keep invisible)
  const hs=mk(new THREE.BoxGeometry(0.001,0.001,0.001),
    new THREE.MeshStandardMaterial({visible:false}));
  hs.position.set(0,2.0,0); g.add(hs);

  g.position.y=0;
  return g;
}


  /** Joe L boss head (bowl cut, red label sign, point light). Moved verbatim. */
  function enemyJoeLBossHead(){
    const g=new THREE.Group();
    const skinM=new THREE.MeshLambertMaterial({color:0xf5c8a0});
    const head=new THREE.Mesh(new THREE.SphereGeometry(1.2,18,14),skinM);
    head.scale.set(1,1.1,1); g.add(head);
    const hairM=new THREE.MeshLambertMaterial({color:0x111111});
    const bowl=new THREE.Mesh(new THREE.SphereGeometry(1.24,16,10,0,Math.PI*2,0,Math.PI*0.42),hairM);
    bowl.position.y=0.2; g.add(bowl);
    // Fringe — smooth capsule instead of box
    const fringe=new THREE.Mesh(new THREE.CapsuleGeometry(0.14,1.82,4,10),hairM);
    fringe.rotation.z=Math.PI/2; fringe.position.set(0,0.62,1.0); g.add(fringe);
    const eyeWM=new THREE.MeshLambertMaterial({color:0xffffff});
    const pupM=new THREE.MeshLambertMaterial({color:0x111111});
    [-0.46,0.46].forEach(function(ex){
      var ew=new THREE.Mesh(new THREE.SphereGeometry(0.22,12,10),eyeWM);
      ew.position.set(ex,0.35,1.0); g.add(ew);
      var ep=new THREE.Mesh(new THREE.SphereGeometry(0.11,10,8),pupM);
      ep.position.set(ex,0.35,1.2); g.add(ep);
      // Glint
      var gl=new THREE.Mesh(new THREE.SphereGeometry(0.04,6,5),eyeWM);
      gl.position.set(ex+0.06,0.40,1.28); g.add(gl);
    });
    const browM=new THREE.MeshLambertMaterial({color:0x111111});
    // Brows — smooth capsule instead of box
    [-0.46,0.46].forEach(function(ex,i){
      var br=new THREE.Mesh(new THREE.CapsuleGeometry(0.06,0.30,4,8),browM);
      br.rotation.z=(i===0?0.55:-0.55)+(Math.PI/2);
      br.position.set(ex,0.68,1.0); g.add(br);
    });
    const nose=new THREE.Mesh(new THREE.SphereGeometry(0.22,10,8),skinM);
    nose.position.set(0,0.04,1.15); nose.scale.set(1,.75,.8); g.add(nose);
    const mouthM=new THREE.MeshLambertMaterial({color:0x991111});
    // Mouth — smooth capsule instead of box
    const mouth=new THREE.Mesh(new THREE.CapsuleGeometry(0.055,0.50,4,8),mouthM);
    mouth.rotation.z=Math.PI/2+0.1; mouth.position.set(0,-0.4,1.1); g.add(mouth);
    [-1.22,1.22].forEach(function(ex){
      var ear=new THREE.Mesh(new THREE.SphereGeometry(0.22,10,8),skinM);
      ear.position.set(ex,0,0); ear.scale.set(0.5,0.7,0.5); g.add(ear);
    });
    const labelM=new THREE.MeshStandardMaterial({color:0xff2244});
    const labelBox=new THREE.Mesh(new THREE.BoxGeometry(3.5,0.6,0.05),labelM);
    labelBox.position.y=2.5; g.add(labelBox);
    g.add(new THREE.PointLight(0xff2244,3,12));
    g.scale.setScalar(1.8);
    return g;
    }


  /** Moto stooge (bike + rider). Wheel-spin animation rotates children[2]/[3] — add order preserved. */
  function enemyMotoStooge(){
  const g=new THREE.Group();
  const motoM=new THREE.MeshLambertMaterial({color:0x1144cc});
  const frame=new THREE.Mesh(new THREE.BoxGeometry(1.5,0.5,0.35),motoM);
  frame.position.y=0.38; g.add(frame);
  const wheelM=new THREE.MeshLambertMaterial({color:0x222222});
  [-0.58,0.58].forEach(function(wx){
    const w=new THREE.Mesh(new THREE.TorusGeometry(0.3,0.1,8,16),wheelM);
    w.rotation.y=Math.PI/2; w.position.set(wx,0.32,0); g.add(w);
  });
  const bodyM=new THREE.MeshLambertMaterial({color:0x1155ee});
  const torso=new THREE.Mesh(new THREE.BoxGeometry(0.5,0.55,0.38),bodyM);
  torso.position.set(-0.1,0.85,0); g.add(torso);
  const helmM=new THREE.MeshLambertMaterial({color:0x0033bb});
  const helm=new THREE.Mesh(new THREE.SphereGeometry(0.35,8,7),helmM);
  helm.position.set(-0.1,1.35,0); g.add(helm);
  const mustM=new THREE.MeshLambertMaterial({color:0x222222});
  [-0.14,0.14].forEach(function(mx){
    const m=new THREE.Mesh(new THREE.TorusGeometry(0.1,0.04,6,10,Math.PI),mustM);
    m.position.set(-0.1+mx,1.2,0.34); m.rotation.z=mx>0?-0.4:0.4; m.rotation.x=-0.3; g.add(m);
  });
  const el=new THREE.PointLight(0x3366ff,1.2,5); el.position.set(-0.7,0.4,0); g.add(el);
  return g;
  }


  /** Fat stooge boss (chef hat, HP gems named hpgem0/hpgem1). Moved verbatim. */
  function enemyFatStooge(){
  const g=new THREE.Group();
  const skinM=new THREE.MeshLambertMaterial({color:0xf5c8a0});
  const body=new THREE.Mesh(new THREE.SphereGeometry(0.75,10,8),skinM);
  body.scale.set(1.1,1.0,1.0); body.position.y=0.2; g.add(body);
  const shirtM=new THREE.MeshLambertMaterial({color:0xcc2222});
  const shirt=new THREE.Mesh(new THREE.SphereGeometry(0.72,10,8),shirtM);
  shirt.scale.set(1.1,0.7,1.0); shirt.position.y=0.05; g.add(shirt);
  const head=new THREE.Mesh(new THREE.SphereGeometry(0.52,10,8),skinM);
  head.position.y=1.15; g.add(head);
  const eyeM=new THREE.MeshLambertMaterial({color:0xffffff});
  const pupM=new THREE.MeshLambertMaterial({color:0x111111});
  [-0.2,0.2].forEach(function(ex){
    const ew=new THREE.Mesh(new THREE.SphereGeometry(0.11,6,5),eyeM); ew.position.set(ex,1.22,0.46); g.add(ew);
    const ep=new THREE.Mesh(new THREE.SphereGeometry(0.055,5,4),pupM); ep.position.set(ex,1.22,0.55); g.add(ep);
  });
  const hatM=new THREE.MeshLambertMaterial({color:0x3a2a14});
  const brim=new THREE.Mesh(new THREE.CylinderGeometry(0.62,0.62,0.08,12),hatM);
  brim.position.set(0,1.58,0); g.add(brim);
  const crown=new THREE.Mesh(new THREE.CylinderGeometry(0.36,0.44,0.45,12),hatM);
  crown.position.set(0,1.82,0); g.add(crown);
  const pastM=new THREE.MeshLambertMaterial({color:0xffee99});
  const pasta=new THREE.Mesh(new THREE.TorusGeometry(0.18,0.04,6,16),pastM);
  pasta.position.set(0.9,0.55,0.2); pasta.rotation.x=0.5; g.add(pasta);
  const gemM=new THREE.MeshLambertMaterial({color:0xff2222,emissive:0xaa0000,emissiveIntensity:0.8});
  const gem1=new THREE.Mesh(new THREE.OctahedronGeometry(0.1),gemM);
  gem1.position.set(-0.12,2.15,0); gem1.name='hpgem0'; g.add(gem1);
  const gem2=gem1.clone(); gem2.position.set(0.12,2.15,0); gem2.name='hpgem1'; g.add(gem2);
  const pl=new THREE.PointLight(0xff2244,1.2,5); pl.position.set(0,1,0); g.add(pl);
  return g;
  }


  /** Dodo bird (durag level thrower). userData.bodyMesh preserved. Moved verbatim. */
  function enemyDodoBird(){
    var g3 = new THREE.Group();
    var bodyM3  = new THREE.MeshLambertMaterial({color:0x8b6f47});
    var bellyM3 = new THREE.MeshLambertMaterial({color:0xc4a378});
    var beakM3  = new THREE.MeshLambertMaterial({color:0xddaa44});
    var legM3   = new THREE.MeshLambertMaterial({color:0xddaa44});
    var eyeWM3  = new THREE.MeshLambertMaterial({color:0xffffff});
    var pupM3   = new THREE.MeshLambertMaterial({color:0x000000});
    var tailM3  = new THREE.MeshLambertMaterial({color:0xf4ddaa});
    var mk3 = function(geo,mat){ var m=new THREE.Mesh(geo,mat); m.castShadow=true; return m; };
    // Plump body — more segments so it reads round, not faceted
    var body3 = mk3(new THREE.SphereGeometry(0.7,18,14), bodyM3);
    body3.scale.set(1.05,1.0,1.22); body3.position.y=0.85; g3.add(body3);
    g3.userData.bodyMesh = body3;
    // Belly
    var belly3 = mk3(new THREE.SphereGeometry(0.52,14,12), bellyM3);
    belly3.scale.set(0.88,0.68,0.98); belly3.position.set(0,0.74,0.18); g3.add(belly3);
    // Head — rounder
    var head3 = mk3(new THREE.SphereGeometry(0.42,16,14), bodyM3);
    head3.position.set(0,1.54,0.34); g3.add(head3);
    // Eyes — bigger, more vivid
    [-0.18,0.18].forEach(function(ex){
      var ew3 = mk3(new THREE.SphereGeometry(0.12,12,10), eyeWM3);
      ew3.position.set(ex,1.62,0.64); g3.add(ew3);
      var ep3 = mk3(new THREE.SphereGeometry(0.065,10,8), pupM3);
      ep3.position.set(ex,1.62,0.72); g3.add(ep3);
      // Iris glint
      var gl = mk3(new THREE.SphereGeometry(0.022,6,5), eyeWM3);
      gl.position.set(ex+0.03,1.65,0.76); g3.add(gl);
    });
    // Hooked beak — smooth cone + rounded tip
    var beakUp3 = mk3(new THREE.ConeGeometry(0.16,0.50,14), beakM3);
    beakUp3.rotation.x = Math.PI*0.55; beakUp3.position.set(0,1.50,0.72); g3.add(beakUp3);
    var beakLo3 = mk3(new THREE.ConeGeometry(0.12,0.36,12), beakM3);
    beakLo3.rotation.x = Math.PI*0.62; beakLo3.position.set(0,1.38,0.74); g3.add(beakLo3);
    var beakTip = mk3(new THREE.SphereGeometry(0.06,10,8), beakM3);
    beakTip.position.set(0,1.34,0.96); g3.add(beakTip);
    // Stubby wings — rounded blobs instead of stretched spheres
    [-0.54,0.54].forEach(function(wx2){
      var wing3 = mk3(new THREE.SphereGeometry(0.24,12,10), bodyM3);
      wing3.scale.set(0.42,0.72,0.92); wing3.position.set(wx2,0.96,0); g3.add(wing3);
      // Feather hint — small dark sphere on trailing edge
      var tip3 = mk3(new THREE.SphereGeometry(0.10,8,6), new THREE.MeshLambertMaterial({color:0x6b4f2f}));
      tip3.position.set(wx2*1.18,0.88,-0.12); g3.add(tip3);
    });
    // Tail tuft — rounder
    var tail3 = mk3(new THREE.SphereGeometry(0.28,12,10), tailM3);
    tail3.scale.set(1.1,0.72,0.62); tail3.position.set(0,1.06,-0.65); g3.add(tail3);
    // Legs — smooth tapered capsule instead of plain cylinder
    [-0.18,0.18].forEach(function(lx2){
      var legG = new THREE.Group();
      legG.position.set(lx2, 0.54, 0.04);
      var legCyl = mk3(new THREE.CylinderGeometry(0.065,0.075,0.54,12), legM3);
      legG.add(legCyl);
      g3.add(legG);
      // Smooth round foot replacing the box
      var foot3 = mk3(new THREE.SphereGeometry(0.14,12,10), legM3);
      foot3.scale.set(1.3,0.6,1.8); // flat and wide, forward-pointing shoe shape
      foot3.position.set(lx2,0.06,0.12); g3.add(foot3);
      // Three rounded toes
      [-0.10,0,0.10].forEach(function(tx){
        var toe = mk3(new THREE.CapsuleGeometry(0.025,0.14,4,8), legM3);
        toe.rotation.x = Math.PI/2;
        toe.position.set(lx2+tx, 0.04, 0.24); g3.add(toe);
      });
    });
    g3.scale.set(1.5,1.5,1.5);
    return g3;
    return g3;
  }

  // ── GLB swap wrapper (V13.8.0) ──────────────────────────────────────────────
  // When USE_PLACEHOLDERS is false and AssetManager.js has a loaded, game-
  // scaled GLB for this character name, return a fresh clone of it; in every
  // other case (flag on, Assets missing, file missing, load failed, character
  // contract-bound) fall through to the procedural placeholder builder.
  // Per-character, per-spawn, always reversible — the game never breaks over
  // an asset.
  function wGLB(name, fn) {
    return function () {
      try {
        if (window.USE_PLACEHOLDERS === false && window.Assets && window.Assets.has(name)) {
          var m = window.Assets.get(name);
          if (m) return m;
        }
      } catch (e) { /* any asset-layer failure → placeholder, never a broken build */ }
      return fn.apply(null, arguments);
    };
  }

  window.Factory = {
    // ── Characters ──────────────────────────────────────────────────────────
    playerDRDD:            wGLB('playerDRDD', playerDRDD),
    characterDRDDFrogTop:  wGLB('characterDRDDFrogTop', characterDRDDFrogTop),
    enemyStooge:           wGLB('enemyStooge', enemyStooge),
    enemyStooge_Moe:       wGLB('enemyStooge_Moe', function () { return enemyStooge(0, 0x44aa44, 0x112211); }),
    enemyStooge_Larry:     wGLB('enemyStooge_Larry', function () { return enemyStooge(1, 0x3355dd, 0x112244); }),
    enemyStooge_Curly:     wGLB('enemyStooge_Curly', function () { return enemyStooge(2, 0xaa33cc, 0x330844); }),
    characterMicFlex:      wGLB('characterMicFlex', characterMicFlex),
    characterMicFlexDurag: wGLB('characterMicFlexDurag', characterMicFlexDurag),
    characterDuragDada:    wGLB('characterDuragDada', characterDuragDada),
    characterDuragDadaDurag: wGLB('characterDuragDadaDurag', characterDuragDadaDurag),
    enemyDuragStooge:      wGLB('enemyDuragStooge', enemyDuragStooge),
    characterDipeGenie:    wGLB('characterDipeGenie', characterDipeGenie),
    enemyOztrich:          wGLB('enemyOztrich', enemyOztrich),
    enemyOztrichChase:     wGLB('enemyOztrichChase', enemyOztrichChase),
    enemyPidgin:           wGLB('enemyPidgin', enemyPidgin),
    enemyPidginChase:      wGLB('enemyPidginChase', enemyPidginChase),
    enemySeagle:           wGLB('enemySeagle', enemySeagle),
    enemySeagleChase:      wGLB('enemySeagleChase', enemySeagleChase),
    enemyRoadstumbler:     wGLB('enemyRoadstumbler', enemyRoadstumbler),
    enemyRoadstumblerBoss: wGLB('enemyRoadstumblerBoss', enemyRoadstumblerBoss),
    enemyKakapoo:          wGLB('enemyKakapoo', enemyKakapoo),
    enemyKakapooFrog:      wGLB('enemyKakapooFrog', enemyKakapooFrog),
    enemyPootoo:           wGLB('enemyPootoo', enemyPootoo),
    enemyPootooFrog:       wGLB('enemyPootooFrog', enemyPootooFrog),
    enemyGobbler:          wGLB('enemyGobbler', enemyGobbler),
    enemyDooDoo:           wGLB('enemyDooDoo', enemyDooDoo),
    enemyJoeLBossHead:     wGLB('enemyJoeLBossHead', enemyJoeLBossHead),
    enemyMotoStooge:       wGLB('enemyMotoStooge', enemyMotoStooge),
    enemyFatStooge:        wGLB('enemyFatStooge', enemyFatStooge),
    enemyDodoBird:         wGLB('enemyDodoBird', enemyDodoBird),

    // ── Props / Environment ──────────────────────────────────────────────────
    propPineTree:         propPineTree,
    propRock:             propRock,
    propBush:             propBush,
    propPoop:             propPoop,
    propFrogTree:         propFrogTree,
    propFrogBush:         propFrogBush,
    propLilyPad:          propLilyPad,

    // ── Utility helpers exposed for custom one-off usage ─────────────────────
    _mat:   mat,    // mat(hexColor, options)  → MeshStandardMaterial
    _mk:    mk,     // mk(geo, mat)            → Mesh with castShadow=true
    _limb:  limb,   // limb(rTop,rBot,h,mat)  → smooth tapered limb Mesh (single geometry, cached)
    _smoothHead: smoothHead,
    _latheTorso: latheTorso,
  };

  console.log('[Factory.js] Loaded — window.Factory ready. USE_PLACEHOLDERS =', window.USE_PLACEHOLDERS);
})();
