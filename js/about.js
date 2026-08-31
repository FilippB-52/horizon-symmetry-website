/* ===================================================================
   Horizon Symmetry — about field

   The team image is not resampled into a sparse grid of particles: it
   is drawn as one GPU point per device pixel, carrying that pixel's own
   colour. At rest the result is the photograph, exactly, at full
   brightness. Only the geometry is ours to move.

   Points below a luminance floor are dropped once on the CPU, so the
   black sky costs nothing and the buffer holds only lit pixels.

   The section runs a sequence, not a single picture. Each frame in
   `data-frames` gets its own point cloud, sampled to the same grid. A
   frame holds, breaks apart into the scatter the entrance came out of,
   and the next one gathers out of the same cloud while it is still
   flying — so the two never read as a cut between images, only as the
   light rearranging itself. With one frame listed there is nothing to
   hand on to and the field simply assembles once, as it always did.

   The cursor pushes every point inside its radius out to the rim, which
   opens a clean void and packs the displaced light around its edge. The
   field also feathers out at all four sides, so a full-bleed image can
   meet the page without a cut.

   See styles.css `.about`.
   =================================================================== */

(function () {
  "use strict";

  var section = document.querySelector(".about");
  if (!section) return;

  var frame  = section.querySelector(".about__frame");
  var canvas = section.querySelector(".about__canvas");
  if (!frame || !canvas) return;

  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  /* --- tuning ------------------------------------------------------- */

  // In order. Every frame is sampled to the same grid and keeps its own
  // buffers for the life of the page, so each one costs what the single
  // picture used to: worth knowing before the list grows long.
  //
  /* Three widths, because the grid this samples varies by a factor of six
     across the screens it runs on.

     Below the styles.css breakpoint the frame is nearly square, cover
     scales the picture by its height, and a phone samples barely 800px
     across it: half-width files, a quarter of the bytes, no difference it
     could possibly show. Past 2300css the grid runs wider than the
     standard file — a 27in screen samples 4690 across and an ultrawide
     5437 — so those get the full master rather than a file stretched to
     reach them. Everything between is covered by the standard tier.

     Chosen once, at load. A window resized across a boundary keeps what
     it already has, which is the right trade: the files are large and
     the difference at the boundary is not visible. */
  var wide   = matchMedia("(min-width: 2300px)").matches;
  var narrow = matchMedia("(max-width: 900px)").matches;
  var SRCS = ((narrow && section.dataset.framesNarrow) ||
              (wide && section.dataset.framesWide) ||
              section.dataset.frames || section.dataset.src || "assets/about-1.jpg")
    .split(",")
    .map(function (s) { return s.trim(); })
    .filter(Boolean);

  // Dimmer than this is sky and is dropped. Low, deliberately: at 9 the
  // faint haze around the figures went with it and the picture read as
  // isolated dots. At 5 it keeps 95% of the light for 55% of the pixels.
  var LUMA_CUT   = 5 / 255;
  var GAIN       = 1.28;      // lifts the whole field; baked in at build
  /* Budget for the picture itself, not the canvas.

     This is what decides how much of a wide screen the field actually
     resolves. Below the budget MAX_DPR binds instead and the points land
     one per physical pixel; above it the backing store comes out smaller
     than the area it covers and the browser stretches the whole field to
     fit, which blurs every point at once — at 5.2e6 that began at about
     1760css and reached a 0.81 render scale on a 27in screen.

     Raising it costs nothing on any window narrow enough for MAX_DPR to
     bind, since the budget is not what is limiting those. It buys back
     the wide ones, where it is paid for in point buffers: about 29MB a
     frame at the ceiling, and every frame in the sequence keeps its own. */
  var MAX_PIXELS = 6.6e6;
  var MAX_DPR    = 2;

  var ENTER_MS   = 2200;      // how long the assembly takes
  var EXIT_MS    = 1700;      // and how long a frame takes to come apart
  var LAG_MS     = 380;       // head start the outgoing frame gets: short, so
                              // the two clouds are in the air together
  var HOLD_MS    = 4200;      // how long an assembled frame is held
  var STAGGER    = 0.45;      // share of it spent waiting for a turn
  var THROW      = 0.75;      // scatter distance, share of the long side
  var EDGE       = 0.45;      // canvas-edge fade, share of the overhang

  var RADIUS     = 0.045;     // repulsion radius, share of frame width
  var RADIUS_MIN = 58;
  var RADIUS_MAX = 130;
  var PUSH       = 0.85;      // overall displacement scale
  var RAMP       = 0.09;      // how fast the push fades in and out
  var FEATHER_X  = 0;         // none: the field runs to the screen edges
  var FEATHER_T  = 0.10;      // top edge
  var FEATHER_B  = 0.22;      // bottom, deeper: the picture has to fall away
                              // into the copy sitting under it

  var DIM        = 0.76;      // how far the field drops behind the copy
  var DIM_PAD    = 16;        // CSS px of solid dimming around each block
  var DIM_SOFT   = 88;        // CSS px the dimming takes to fade out

  var SLEEP      = 20;        // still frames before the loop parks

  var VERT = [
    "#version 300 es",
    "in vec2 aHome;",          // device pixels, pixel centres
    "in vec4 aColor;",
    "uniform vec2  uRes;",
    "uniform vec2  uMouse;",
    "uniform float uRadius;",
    "uniform float uPush;",
    "uniform float uStrength;",
    "uniform float uProgress;",
    "uniform float uExit;",     // 0 gathering, 1 coming apart
    "uniform float uSeed;",     // one scatter field per pass
    "uniform float uScatter;",
    "uniform float uStagger;",
    "uniform vec3  uFeather;",  // fade widths: sides, top, bottom
    "uniform vec2  uImgO;",     // the picture's corner within the canvas
    "uniform vec2  uImgS;",     // and its size, both device px
    "uniform vec2  uEdge;",     // fade band at the canvas boundary
    "uniform float uSpeed;",
    "uniform vec4  uDim0;",     // copy blocks to darken behind: centre, half size
    "uniform vec4  uDim1;",
    "uniform vec2  uDimAS;",    // strength, and the distance it fades over
    "out vec4 vColor;",

    "float hash(vec2 p) {",
    "  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);",
    "}",

    // 1 inside the block, easing to 0 across uDimAS.y outside it
    "float shade(vec4 b, vec2 p, float soft) {",
    "  vec2 q = abs(p - b.xy) - b.zw;",
    "  float d = length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0);",
    "  return 1.0 - smoothstep(0.0, soft, d);",
    "}",

    "void main() {",
    // +0.5 puts the point on the centre of its pixel rather than on the
    // boundary between two, which is the difference between a crisp dot
    // and one smeared across a seam.
    "  vec2 home = aHome + 0.5;",
    // A pass gets its own offset into the noise, so a frame never leaves
    // along the path the one before it arrived on.
    "  vec2 sd = vec2(uSeed, uSeed * 1.73);",
    "  float h1 = hash(home + sd);",
    "  float h2 = hash(home + 17.3 + sd);",
    "  float h3 = hash(home * 0.7 + 3.1 + sd);",

    "  vec2 uv = (home - uImgO) / uImgS;",

    // The wave along the bottom lands first, so the figures resolve last.
    // A frame on its way out runs the wave from the other side, so it is
    // already breaking up along the top while the next one is still
    // gathering from below.
    "  float delay = (0.55 * h3 + 0.45 * mix(1.0 - uv.y, uv.y, uExit)) * uStagger;",
    "  float local = clamp((uProgress - delay) / max(0.0001, 1.0 - uStagger), 0.0, 1.0);",
    // The arrival is sharp: nearly all of the travel is spent slowing down
    // into place. The departure is deliberately not — at the same power the
    // picture is gone within a few frames and leaves a hole where the next
    // one has not arrived yet, so it comes apart on a flatter curve.
    "  float e = 1.0 - pow(1.0 - local, mix(4.0, 2.0, uExit));",

    // k is 1 at home and 0 fully scattered: the entrance read forwards,
    // the exit read out of it. Light is held a little past the movement
    // on the way out, so a frame comes apart rather than switching off.
    "  float k = mix(e, 1.0 - e, uExit);",
    "  float a = mix(e, pow(1.0 - e, 0.55), uExit);",

    "  float ang  = h1 * 6.2831853;",
    "  float dist = (0.35 + 0.65 * h2) * uScatter;",
    "  vec2 pos = mix(home + vec2(cos(ang), sin(ang)) * dist, home, k);",

    // Pushing every point out to the rim would empty a perfect disc, which
    // reads as a black circle dragged over the picture rather than as pixels
    // being disturbed. So the displacement varies per point instead: each one
    // gets its own throw distance, a curl around the cursor, and a straight
    // random scatter. The void still opens, but its edge is ragged and the
    // pixels visibly break up.
    "  vec2 d = pos - uMouse;",
    "  float len = max(length(d), 0.0001);",
    "  float t = 1.0 - len / uRadius;",          // 0 at the rim, 1 at the centre
    "  float s = uStrength * pow(uStrength, h3 * 0.9);",  // each settles back at its own pace
    "  if (s > 0.0 && t > 0.0) {",
    "    vec2 dir = d / len;",
    "    vec2 tang = vec2(-dir.y, dir.x);",
    "    float kick = 0.45 + 1.35 * h2 * h2;",   // a few fly far, most barely move
    "    float curl = 0.35 * t + (h1 - 0.5) * 0.9;",
    "    float boost = 1.0 + uSpeed * 0.9;",     // a fast pass throws harder
    "    vec2 off = (dir + tang * curl) * uRadius * pow(t, 0.7) * kick * boost;",
    "    off += vec2(h3 - 0.5, h1 - 0.5) * uRadius * 1.15 * t * boost;",
    "    pos += off * uPush * s;",
    "  }",

    "  float fx = smoothstep(0.0, uFeather.x, uv.x) * smoothstep(0.0, uFeather.x, 1.0 - uv.x);",
    "  float fy = smoothstep(0.0, uFeather.y, uv.y) * smoothstep(0.0, uFeather.z, 1.0 - uv.y);",

    // A point on its way in must never be cut off by the canvas: it fades
    // to nothing before it can reach the boundary. At rest the picture sits
    // well inside the overhang, so this costs it nothing.
    "  vec2 m = min(pos, uRes - pos) / uEdge;",
    "  float edge = smoothstep(0.0, 1.0, clamp(min(m.x, m.y), 0.0, 1.0));",

    // the copy sits over the foot of the picture, so the points beneath it
    // drop away rather than tangling with the type
    "  float sh = max(shade(uDim0, pos, uDimAS.y), shade(uDim1, pos, uDimAS.y));",
    "  float dim = 1.0 - uDimAS.x * sh;",

    "  vColor = vec4(aColor.rgb, aColor.a * a * fx * fy * edge * dim);",
    "  gl_PointSize = 1.0;",
    "  vec2 clip = (pos / uRes) * 2.0 - 1.0;",
    "  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);",
    "}"
  ].join("\n");

  var FRAG = [
    "#version 300 es",
    "precision highp float;",
    "in vec4 vColor;",
    "out vec4 outColor;",
    "void main() {",
    "  if (vColor.a <= 0.004) discard;",
    "  outColor = vec4(vColor.rgb * vColor.a, vColor.a);",  // premultiplied
    "}"
  ].join("\n");

  /* --- state -------------------------------------------------------- */

  var gl = canvas.getContext("webgl2", {
    alpha: true,
    antialias: false,
    premultipliedAlpha: true,
    // the loop parks once the field is at rest, so the last frame has to hold
    preserveDrawingBuffer: true
  });
  if (!gl) return;   // the <img> underneath stays

  var prog = null, loc = {};
  var W = 0, H = 0;                    // the picture, CSS px
  var PW = 0, PH = 0;                  // the canvas, device px
  var IX = 0, IY = 0, IW = 0, IH = 0;  // the picture within it, device px
  var dpr = 1;

  var imgs = [];        // decoded sources, by frame
  var sets = [];        // { vao, count } per frame, once sampled
  var fetching = false;

  // cur is the frame at home or gathering; prev is the one coming apart,
  // -1 when the field is showing a single picture.
  var cur = 0, prev = -1;
  var entered = false, wantsEnter = false;
  var enterStart = 0, exitStart = 0, holdFrom = 0;
  var progress = 0, outProgress = 0;
  var strength = 0, targetStrength = 0;

  var raf = 0, running = false, parkedAt = 0;
  var idle = 0;

  var mouse = { x: -1e5, y: -1e5 };      // device px, smoothed
  var aim   = { x: -1e5, y: -1e5, on: false };
  var clientX = -1e5, clientY = -1e5, speed = 0;

  /* --- program ------------------------------------------------------ */

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      gl.deleteShader(s);
      return null;
    }
    return s;
  }

  function link() {
    var vs = compile(gl.VERTEX_SHADER, VERT);
    var fs = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return false;
    prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;

    ["uRes", "uMouse", "uRadius", "uPush", "uStrength", "uProgress",
     "uExit", "uSeed", "uScatter", "uStagger", "uFeather", "uSpeed",
     "uImgO", "uImgS", "uEdge",
     "uDim0", "uDim1", "uDimAS"].forEach(function (n) {
      loc[n] = gl.getUniformLocation(prog, n);
    });

    gl.useProgram(prog);
    gl.uniform1f(loc.uStagger, STAGGER);
    gl.uniform1f(loc.uPush, PUSH);
    gl.uniform3f(loc.uFeather, FEATHER_X, FEATHER_T, FEATHER_B);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
    return true;
  }

  /* --- sampling ----------------------------------------------------- */

  // One point per device pixel of the backing store: the image is drawn
  // to cover at exactly that size, so home positions land on pixel
  // centres and the field is pixel-identical to the source at rest.
  // Every frame is sampled to the same grid, so they scatter into and out
  // of one another without anything having to be scaled between them.
  function buildSet(i) {
    var img = imgs[i];
    if (!img || !IW || !IH || !prog) return;

    var off = document.createElement("canvas");
    off.width = IW;
    off.height = IH;
    var oc = off.getContext("2d", { willReadFrequently: true });

    var iw = img.naturalWidth  || img.width;
    var ih = img.naturalHeight || img.height;
    var s  = Math.max(IW / iw, IH / ih);
    var dw = iw * s, dh = ih * s;
    oc.drawImage(img, (IW - dw) / 2, (IH - dh) / 2, dw, dh);

    var px;
    try {
      px = oc.getImageData(0, 0, IW, IH).data;
    } catch (e) {
      return;   // tainted — the fallback image stays
    }

    var total = IW * IH;
    var home = new Uint16Array(total * 2);
    var cols = new Uint8Array(total * 4);
    var cut = LUMA_CUT * 255;
    var n = 0;

    for (var y = 0; y < IH; y++) {
      var row = y * IW;
      for (var x = 0; x < IW; x++) {
        var p = (row + x) * 4;
        var r = px[p], g = px[p + 1], b = px[p + 2];
        // Rec. 601 luma, in 0..255
        if (r * 0.299 + g * 0.587 + b * 0.114 < cut) continue;
        var h2 = n * 2, c4 = n * 4;
        home[h2] = x + IX;          // shifted into canvas space
        home[h2 + 1] = y + IY;
        // clamped, not truncated: a Uint8Array wraps anything over 255
        cols[c4]     = r * GAIN > 255 ? 255 : r * GAIN;
        cols[c4 + 1] = g * GAIN > 255 ? 255 : g * GAIN;
        cols[c4 + 2] = b * GAIN > 255 ? 255 : b * GAIN;
        cols[c4 + 3] = 255;
        n++;
      }
    }

    if (!n) return;

    if (sets[i]) gl.deleteVertexArray(sets[i].vao);
    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    var hb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, hb);
    gl.bufferData(gl.ARRAY_BUFFER, home.subarray(0, n * 2), gl.STATIC_DRAW);
    var aHome = gl.getAttribLocation(prog, "aHome");
    gl.enableVertexAttribArray(aHome);
    gl.vertexAttribPointer(aHome, 2, gl.UNSIGNED_SHORT, false, 0, 0);

    var cb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cb);
    gl.bufferData(gl.ARRAY_BUFFER, cols.subarray(0, n * 4), gl.STATIC_DRAW);
    var aColor = gl.getAttribLocation(prog, "aColor");
    gl.enableVertexAttribArray(aColor);
    gl.vertexAttribPointer(aColor, 4, gl.UNSIGNED_BYTE, true, 0, 0);

    gl.bindVertexArray(null);
    sets[i] = { vao: vao, count: n };
  }

  // A rebuild after the entrance has run must not replay it, and must not
  // leave half a handover on screen.
  function build() {
    if (!prog || !IW || !IH) return;
    for (var i = 0; i < SRCS.length; i++) if (imgs[i]) buildSet(i);
    if (!sets[cur]) return;     // nothing sampled yet; the <img> holds

    prev = -1;
    progress = entered ? 1 : 0;
    holdFrom = 0;
    measureDim();               // the copy may have laid out after sizing
    frame.classList.add("is-live");
    if (wantsEnter) enter();
    wake();
  }

  function enter() {
    if (entered) return;
    if (!sets[cur]) { wantsEnter = true; return; }   // samples not in yet
    entered = true;
    wantsEnter = false;
    enterStart = performance.now();
    section.classList.add("is-in");
    wake();
  }

  // The next frame that has actually been sampled, so a source that is
  // slow to arrive is skipped rather than showing as a gap.
  function nextIndex(i) {
    for (var n = 1; n <= SRCS.length; n++) {
      var j = (i + n + SRCS.length) % SRCS.length;
      if (sets[j]) return j;
    }
    return i;
  }

  function built() {
    var n = 0;
    for (var i = 0; i < SRCS.length; i++) if (sets[i]) n++;
    return n;
  }

  // Hand the field to the next frame: this one starts coming apart, and
  // the next gathers out of the same cloud a beat later.
  function advance(now) {
    prev = cur;
    exitStart = now;
    outProgress = 0;
    cur = nextIndex(cur);
    enterStart = now + LAG_MS;
    progress = 0;
    holdFrom = 0;
  }

  /* --- sizing ------------------------------------------------------- */

  // The canvas is larger than the picture. Its overhang is set in CSS and
  // read back here, so the two can never disagree. All coordinates below
  // are canvas device pixels.
  function measure() {
    var cr = canvas.getBoundingClientRect();
    var fr = frame.getBoundingClientRect();
    if (!cr.width || !fr.width) return false;

    W = fr.width; H = fr.height;
    dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    // the budget covers the picture, which is what sets the point count
    var budget = Math.sqrt(MAX_PIXELS / (W * H));
    if (budget < dpr) dpr = Math.max(1, budget);

    PW = Math.round(cr.width * dpr);
    PH = Math.round(cr.height * dpr);
    IX = Math.round((fr.left - cr.left) * dpr);
    IY = Math.round((fr.top - cr.top) * dpr);
    IW = Math.round(W * dpr);
    IH = Math.round(H * dpr);
    return true;
  }

  function resize() {
    if (!measure()) return;
    canvas.width = PW;
    canvas.height = PH;
    gl.viewport(0, 0, PW, PH);

    gl.useProgram(prog);
    gl.uniform2f(loc.uRes, PW, PH);
    gl.uniform2f(loc.uImgO, IX, IY);
    gl.uniform2f(loc.uImgS, IW, IH);
    gl.uniform1f(loc.uScatter, Math.max(IW, IH) * THROW);
    // fade in from the boundary across part of the overhang
    gl.uniform2f(loc.uEdge,
      Math.max(1, IX * EDGE), Math.max(1, IY * EDGE));
    measureDim();
  }

  // The darkened patches follow wherever the copy actually lands, rather
  // than a guess at where the layout put it.
  function measureDim() {
    if (!prog || !PW) return;
    var cr = canvas.getBoundingClientRect();
    if (!cr.width || !cr.height) return;
    var sx = PW / cr.width, sy = PH / cr.height;

    var set = function (u, sel) {
      var el = section.querySelector(sel);
      var r = el && el.getBoundingClientRect();
      if (!r || !r.width || !r.height) {
        gl.uniform4f(u, -1e6, -1e6, 0, 0);   // parked well out of the way
        return;
      }
      gl.uniform4f(u,
        (r.left + r.width / 2 - cr.left) * sx,
        (r.top + r.height / 2 - cr.top) * sy,
        (r.width / 2 + DIM_PAD) * sx,
        (r.height / 2 + DIM_PAD) * sy);
    };

    gl.useProgram(prog);
    set(loc.uDim0, ".about__text");
    set(loc.uDim1, ".about__action");
    gl.uniform2f(loc.uDimAS, DIM, DIM_SOFT * dpr);
  }

  /* --- frame -------------------------------------------------------- */

  function pass(set, p, exit, seed) {
    if (!set || !set.count) return;
    if (!exit && p <= 0) return;      // not started
    if (exit && p >= 1) return;       // gone
    gl.uniform1f(loc.uProgress, p);
    gl.uniform1f(loc.uExit, exit);
    gl.uniform1f(loc.uSeed, seed);
    gl.bindVertexArray(set.vao);
    gl.drawArrays(gl.POINTS, 0, set.count);
    gl.bindVertexArray(null);
  }

  function render() {
    raf = requestAnimationFrame(render);
    if (!prog || !sets[cur]) return;

    var now = performance.now();
    var moving = false;

    if (entered) {
      if (progress < 1) {
        progress = Math.max(0, Math.min(1, (now - enterStart) / ENTER_MS));
        moving = true;
      }
      if (prev >= 0) {
        outProgress = Math.min(1, (now - exitStart) / EXIT_MS);
        if (outProgress >= 1) prev = -1;
        moving = true;
      }
      // An assembled frame is held, then handed on. With nothing to hand
      // it to, holdFrom never gets set and the field rests where it is.
      if (prev < 0 && progress >= 1 && built() > 1) {
        if (!holdFrom) holdFrom = now;
        else if (now - holdFrom >= HOLD_MS) { advance(now); moving = true; }
      }
    }

    // The push ramps rather than snapping, so leaving the frame lets the
    // field flow back instead of jumping.
    if (Math.abs(targetStrength - strength) > 0.001) {
      strength += (targetStrength - strength) * RAMP;
      moving = true;
    } else {
      strength = targetStrength;
    }

    if (aim.on) {
      if (mouse.x < -9e4) { mouse.x = aim.x; mouse.y = aim.y; }
      var dx = aim.x - mouse.x, dy = aim.y - mouse.y;
      if (dx * dx + dy * dy > 0.25) {
        mouse.x += dx * 0.22;   // trails the cursor, so a flick reads as one stroke
        mouse.y += dy * 0.22;
        moving = true;
      }
    }

    if (speed > 0.004) { speed *= 0.9; moving = true; }
    else speed = 0;

    /* A settled field has nothing to redraw. The loop parks on stillness
       and the last frame holds — which is what preserveDrawingBuffer on
       the context is for. A frame being held is settled but not finished:
       there the loop stays alive to hand it on, and simply draws nothing
       until it does. */
    idle = moving ? 0 : idle + 1;
    if (idle > SLEEP) {
      if (!holdFrom) park();
      return;
    }

    gl.useProgram(prog);
    gl.uniform1f(loc.uStrength, strength);
    gl.uniform1f(loc.uRadius,
      Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, W * RADIUS)) * dpr);
    gl.uniform2f(loc.uMouse, mouse.x, mouse.y);
    gl.uniform1f(loc.uSpeed, speed);

    gl.clear(gl.COLOR_BUFFER_BIT);
    // the outgoing frame first: the one arriving belongs on top of it
    if (prev >= 0) pass(sets[prev], outProgress, 1, prev * 3.7 + 1.9);
    pass(sets[cur], progress, 0, cur * 3.7);
  }

  function wake() {
    idle = 0;
    if (running) return;
    /* Time did not pass for the field while it was parked. Without this
       a section scrolled away from and come back to would find its hold
       long expired and cut straight to the next frame. */
    if (parkedAt) {
      var gap = performance.now() - parkedAt;
      if (enterStart) enterStart += gap;
      if (exitStart)  exitStart  += gap;
      if (holdFrom)   holdFrom   += gap;
      parkedAt = 0;
    }
    running = true;
    raf = requestAnimationFrame(render);
  }

  function park() {
    if (running) parkedAt = performance.now();
    running = false;
    cancelAnimationFrame(raf);
  }

  /* --- input -------------------------------------------------------- */

  // Mapped through the rect so any transform or zoom on the frame cannot
  // shrink the effective radius.
  function track(cx, cy) {
    var r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    var nx = (cx - r.left) * (PW / r.width);
    var ny = (cy - r.top)  * (PH / r.height);
    if (aim.on) {
      var dx = nx - aim.x, dy = ny - aim.y;
      speed = Math.min(1, Math.sqrt(dx * dx + dy * dy) / (55 * dpr));
    }
    aim.x = nx;
    aim.y = ny;
    aim.on = true;
    targetStrength = 1;
    wake();
  }

  frame.addEventListener("pointermove", function (e) {
    if (e.pointerType === "touch") return;   // leave the page free to scroll
    clientX = e.clientX;
    clientY = e.clientY;
    track(clientX, clientY);
  }, { passive: true });

  frame.addEventListener("pointerleave", function () {
    aim.on = false;
    targetStrength = 0;
    wake();
  });

  // The cursor can sit still while the page moves under it.
  addEventListener("scroll", function () {
    if (aim.on && clientX > -9e4) track(clientX, clientY);
  }, { passive: true });

  /* --- lifecycle ---------------------------------------------------- */

  if (!link()) return;

  /* Everything that can fail outright has now passed, so the copy under
     the field is allowed to wait for its entrance. Until this class
     lands it is simply visible — a section that cannot draw its points
     must still be able to say who we are. */
  section.classList.add("is-armed");

  var ro = new ResizeObserver(function (entries) {
    var r = entries[0] && entries[0].contentRect;
    if (!r || !r.width || !r.height) return;
    if (Math.round(r.width) === Math.round(W) &&
        Math.round(r.height) === Math.round(H)) return;
    resize();
    build();
  });
  ro.observe(frame);

  // Fetch the sources only once the section is within reach. They are
  // sampled as they land, in whatever order they land in; the sequence
  // starts as soon as a second one is ready.
  new IntersectionObserver(function (entries, obs) {
    if (!entries[0].isIntersecting || fetching) return;
    fetching = true;
    obs.disconnect();
    SRCS.forEach(function (src, i) {
      var im = new Image();
      im.decoding = "async";
      im.onload = function () {
        imgs[i] = im;
        if (!IW || !IH) return;        // the resize will sample it
        buildSet(i);
        /* The sequence always opens on its first frame. A later one that
           decodes sooner waits its turn rather than taking the opening,
           which is what order in the attribute means. */
        if (i === 0 && sets[0]) {
          frame.classList.add("is-live");
          if (wantsEnter) enter();
        }
        wake();
      };
      im.src = src;
    });
  }, { rootMargin: "100% 0px" }).observe(section);

  // Assemble once, when the section is properly in view rather than just
  // clipping the edge. Insetting the root beats a ratio threshold, which
  // a short viewport may never be able to satisfy.
  new IntersectionObserver(function (entries, obs) {
    if (!entries[0].isIntersecting) return;
    obs.disconnect();
    enter();
    /* enter() waits on the samples, and the sampling can still be beaten
       by a decode that never lands or a phone that will not give up the
       memory for it. The copy does not wait that long: on screen and
       still hidden after this, it comes in regardless of the points. */
    setTimeout(function () { section.classList.add("is-in"); }, 2200);
  }, { rootMargin: "-18% 0px -18% 0px" }).observe(section);

  // Off screen there is nothing to animate; the parked frame holds.
  new IntersectionObserver(function (entries) {
    if (entries[0].isIntersecting) wake();
    else park();
  }, { threshold: 0 }).observe(section);
})();
