/* ===================================================================
   Horizon Symmetry — about field

   The team image is not resampled into a sparse grid of particles: it
   is drawn as one GPU point per device pixel, carrying that pixel's own
   colour. At rest the result is the photograph, exactly, at full
   brightness. Only the geometry is ours to move.

   Points below a luminance floor are dropped once on the CPU, so the
   black sky costs nothing and the buffer holds only lit pixels.

   The cursor pushes every point inside its radius out to the rim, which
   opens a clean void and packs the displaced light around its edge. The
   field also feathers out at all four sides, so a full-bleed image can
   meet the page without a cut.

   Particles assemble once, the first time the section is scrolled to,
   and never scatter again. See styles.css `.about`.
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

  var SRC        = section.dataset.src || "assets/team-dots.jpg";
  // Dimmer than this is sky and is dropped. Low, deliberately: at 9 the
  // faint haze around the figures went with it and the picture read as
  // isolated dots. At 5 it keeps 95% of the light for 55% of the pixels.
  var LUMA_CUT   = 5 / 255;
  var GAIN       = 1.28;      // lifts the whole field; baked in at build
  var MAX_PIXELS = 5.2e6;     // budget for the picture itself, not the canvas
  var MAX_DPR    = 2;

  var ENTER_MS   = 2200;      // how long the assembly takes
  var STAGGER    = 0.45;      // share of it spent waiting for a turn
  var THROW      = 0.75;      // scatter distance, share of the long side
  var EDGE       = 0.45;      // canvas-edge fade, share of the overhang

  var RADIUS     = 0.045;     // repulsion radius, share of frame width
  var RADIUS_MIN = 58;
  var RADIUS_MAX = 130;
  var PUSH       = 0.85;      // overall displacement scale
  var RAMP       = 0.09;      // how fast the push fades in and out
  var FEATHER_X  = 0.24;      // edge fade, share of width — sides dissolve early
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
    "  float h1 = hash(home);",
    "  float h2 = hash(home + 17.3);",
    "  float h3 = hash(home * 0.7 + 3.1);",

    "  vec2 uv = (home - uImgO) / uImgS;",

    // The wave along the bottom lands first, so the figures resolve last.
    "  float delay = (0.55 * h3 + 0.45 * (1.0 - uv.y)) * uStagger;",
    "  float local = clamp((uProgress - delay) / max(0.0001, 1.0 - uStagger), 0.0, 1.0);",
    "  float e = 1.0 - pow(1.0 - local, 4.0);",

    "  float ang  = h1 * 6.2831853;",
    "  float dist = (0.35 + 0.65 * h2) * uScatter;",
    "  vec2 pos = mix(home + vec2(cos(ang), sin(ang)) * dist, home, e);",

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

    "  vColor = vec4(aColor.rgb, aColor.a * e * fx * fy * edge * dim);",
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

  var prog = null, vao = null, count = 0, loc = {};
  var W = 0, H = 0;                    // the picture, CSS px
  var PW = 0, PH = 0;                  // the canvas, device px
  var IX = 0, IY = 0, IW = 0, IH = 0;  // the picture within it, device px
  var dpr = 1;

  var img = null, fetching = false;
  var entered = false, wantsEnter = false, enterStart = 0;
  var progress = 0, strength = 0, targetStrength = 0;

  var raf = 0, running = false;
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
     "uScatter", "uStagger", "uFeather", "uSpeed",
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
  function build() {
    if (!img || !IW || !IH || !prog) return;

    // Only the picture is sampled, at exactly its own device size, so home
    // positions land on pixel centres and nothing is resampled twice.
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
        var i = (row + x) * 4;
        var r = px[i], g = px[i + 1], b = px[i + 2];
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

    count = n;
    if (!count) return;

    if (vao) gl.deleteVertexArray(vao);
    vao = gl.createVertexArray();
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

    // A rebuild after the entrance has run must not replay it.
    progress = entered ? 1 : 0;
    measureDim();               // the copy may have laid out after sizing
    frame.classList.add("is-live");
    if (wantsEnter) enter();
    wake();
  }

  function enter() {
    if (entered) return;
    if (!count) { wantsEnter = true; return; }   // samples not in yet
    entered = true;
    wantsEnter = false;
    enterStart = performance.now();
    section.classList.add("is-in");
    wake();
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

  function render() {
    raf = requestAnimationFrame(render);
    if (!count || !prog) return;

    var now = performance.now();
    var moving = false;

    if (entered && progress < 1) {
      progress = Math.min(1, (now - enterStart) / ENTER_MS);
      moving = true;
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

    /* The picture is static, so a settled field has nothing to redraw.
       The loop parks on stillness and the last frame holds — which is what
       preserveDrawingBuffer on the context is for. */
    idle = moving ? 0 : idle + 1;
    if (idle > SLEEP) { park(); return; }

    gl.useProgram(prog);
    gl.uniform1f(loc.uProgress, progress);
    gl.uniform1f(loc.uStrength, strength);
    gl.uniform1f(loc.uRadius,
      Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, W * RADIUS)) * dpr);
    gl.uniform2f(loc.uMouse, mouse.x, mouse.y);
    gl.uniform1f(loc.uSpeed, speed);

    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.POINTS, 0, count);
    gl.bindVertexArray(null);
  }

  function wake() {
    idle = 0;
    if (running) return;
    running = true;
    raf = requestAnimationFrame(render);
  }

  function park() {
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

  var ro = new ResizeObserver(function (entries) {
    var r = entries[0] && entries[0].contentRect;
    if (!r || !r.width || !r.height) return;
    if (Math.round(r.width) === Math.round(W) &&
        Math.round(r.height) === Math.round(H)) return;
    resize();
    build();
  });
  ro.observe(frame);

  // Fetch the source only once the section is within reach.
  new IntersectionObserver(function (entries, obs) {
    if (!entries[0].isIntersecting || fetching) return;
    fetching = true;
    obs.disconnect();
    var im = new Image();
    im.decoding = "async";
    im.onload = function () { img = im; build(); };
    im.src = SRC;
  }, { rootMargin: "100% 0px" }).observe(section);

  // Assemble once, when the section is properly in view rather than just
  // clipping the edge. Insetting the root beats a ratio threshold, which
  // a short viewport may never be able to satisfy.
  new IntersectionObserver(function (entries, obs) {
    if (!entries[0].isIntersecting) return;
    obs.disconnect();
    enter();
  }, { rootMargin: "-18% 0px -18% 0px" }).observe(section);

  // Off screen there is nothing to animate; the parked frame holds.
  new IntersectionObserver(function (entries) {
    if (entries[0].isIntersecting) wake();
    else park();
  }, { threshold: 0 }).observe(section);
})();
