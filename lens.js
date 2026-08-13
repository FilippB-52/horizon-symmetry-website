/* ===================================================================
   Horizon Symmetry — cover lens

   Over a project cover the pointer is replaced by a glass lens that
   magnifies what is underneath it and carries the word that says what
   clicking does.

   The refraction is real rather than drawn: the patch of deck sitting
   under the lens is composited into a small texture each frame and bent
   through a sphere in the shader — centre magnified, rim pushed outward,
   the three channels separated a little more the further out they land.
   The rim shading and the highlight are the only parts that are painted
   rather than sampled.

   Only the patch travels to the GPU, never the whole image, so the cost
   does not scale with how large the card is.

   Two rules hold the whole thing together, and both were learned the
   hard way:

     - the patch is composited out of whatever the deck actually has
       under the glass, not out of the card some class says is in front.
       The deck slides while the lens stays under the pointer, so those
       two answers disagree for the length of every card change.

     - the run never ends quietly. A frame with nothing to draw skips
       and comes back; it does not return without booking the next one.
       A loop that stops while the lens is still on screen leaves the
       last frame frozen there, and that frozen frame then follows the
       visitor to every other project on the deck.
   =================================================================== */

(function () {
  "use strict";

  /* --- tuning ------------------------------------------------------- */

  var PATCH = 1.5;    // source area copied, as a multiple of the lens
  var TEX   = 512;    // texture the patch is composited into
  var ZOOM  = 1.22;   // magnification at the centre — noticeable, not a telescope
  var BEND  = 0.34;   // outward push, confined to the rim
  var ABERR = 0.008;  // channel separation at the rim — barely there on purpose
  var BLUR  = 0.016;  // how far the rim smears, in patch-UV units
  var EDGE0 = 0.60;   // where the rim band starts
  var EASE  = 0.22;   // how much of the distance to the pointer per frame
  var LABEL = "VIEW";   // size lives in CSS, on .deck

  var VOID = "#000000";   // the deck sits on the section's black
  var CARD = "#0C0C0F";   // a card with nothing to show yet
  var FADE = 380;         // ms the fade-out takes, plus a frame or two

  var deck = document.querySelector(".deck");
  if (!deck) return;

  var cards = Array.prototype.slice.call(deck.querySelectorAll(".card"));
  if (!cards.length) return;

  if (window.matchMedia) {
    // a lens is a pointer affordance; without a hovering pointer it is noise
    if (!matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  }

  var FRAG = [
    "#version 300 es",
    "precision highp float;",
    "in vec2 vUv;",
    "out vec4 outColor;",
    "uniform sampler2D uTex;",    // the deck under the lens
    "uniform sampler2D uText;",   // the label, as a mask
    "uniform float uR;",          // lens radius in patch-UV units

    // one sample, with the channels pulled apart by `a`
    "vec3 tap(vec2 uv, float a) {",
    "  vec3 c;",
    "  c.r = texture(uTex, vec2(0.5) + uv * (1.0 + a)).r;",
    "  c.g = texture(uTex, vec2(0.5) + uv).g;",
    "  c.b = texture(uTex, vec2(0.5) + uv * (1.0 - a)).b;",
    "  return c;",
    "}",

    "void main() {",
    "  vec2 p = vUv * 2.0 - 1.0;",
    "  float r = length(p);",
    "  if (r > 1.0) { outColor = vec4(0.0); return; }",

    // The whole lens is one gentle magnification. The extra push lives
    // only in the outer band and rises smoothly, so the mapping never
    // folds back on itself — a fold is what mirrors the image.
    "  float edge = smoothstep(" + EDGE0.toFixed(2) + ", 1.0, r);",
    "  float push = 1.0 + edge * edge * " + BEND.toFixed(3) + ";",
    "  vec2 base = p * (uR / " + ZOOM.toFixed(3) + ") * push;",

    // glass disperses more the further the ray bends, so the split grows
    // toward the rim rather than sitting flat across the lens
    "  float a = " + ABERR.toFixed(4) + " * edge;",
    "  vec3 col = tap(base, a);",

    // the rim also loses focus: six taps around the sample, faded in over
    // the same band, so the edge reads as thick glass rather than a seam
    "  if (edge > 0.001) {",
    "    float b = edge * " + BLUR.toFixed(4) + ";",
    "    vec3 soft = vec3(0.0);",
    "    for (int i = 0; i < 6; i++) {",
    "      float t = float(i) * 1.0471976;",   // 60° apart
    "      soft += tap(base + vec2(cos(t), sin(t)) * b, a);",
    "    }",
    "    col = mix(col, soft / 6.0, edge);",
    "  }",

    // The rim is deliberately almost nothing: a trace of thickness, a
    // whisper of a highlight, a hairline edge. Anything more and the
    // bead stops reading as glass and starts reading as an object.
    "  col *= mix(1.02, 0.94, edge);",
    "  vec2 dir = r > 0.0001 ? p / r : vec2(0.0);",
    "  float sp = smoothstep(0.88, 1.0, r) * max(0.0, dot(dir, normalize(vec2(-0.55, 0.83))));",
    "  col += vec3(1.0) * pow(sp, 2.0) * 0.13;",
    "  float ring = smoothstep(0.95, 0.99, r) * (1.0 - smoothstep(0.99, 1.0, r));",
    "  col += vec3(1.0) * ring * 0.09;",

    // The label is not drawn — it is cut out of the glass. Sampled flat,
    // so it stays upright while everything behind it bends, and the
    // colour it reveals is the inverse of whatever it is sitting over.
    "  float m = texture(uText, vUv).a;",
    "  col = mix(col, vec3(1.0) - col, m);",

    "  outColor = vec4(col, 1.0 - smoothstep(0.975, 1.0, r));",
    "}"
  ].join("\n");

  var VERT = [
    "#version 300 es",
    "in vec2 aPos;",
    "out vec2 vUv;",
    "void main() {",
    "  vUv = aPos * 0.5 + 0.5;",
    "  gl_Position = vec4(aPos, 0.0, 1.0);",
    "}"
  ].join("\n");

  /* --- build -------------------------------------------------------- */

  var box = document.createElement("div");
  box.className = "lens";
  box.setAttribute("aria-hidden", "true");

  var canvas = document.createElement("canvas");
  canvas.className = "lens__gl";

  box.appendChild(canvas);
  deck.appendChild(box);

  var gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: false });
  if (!gl) { box.remove(); return; }

  // the patch of deck under the lens, composited here before it is uploaded
  var patch = document.createElement("canvas");
  patch.width = patch.height = TEX;
  var pctx = patch.getContext("2d");

  var tcan = document.createElement("canvas");   // the label, before upload
  var tctx = tcan.getContext("2d");

  var prog = null, tex = null, textTex = null;
  var lost = false;

  function shader(type, source) {
    var s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  }

  function makeTex(unit) {
    var t = gl.createTexture();
    gl.activeTexture(unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  }

  /* Everything the context owns, in one place — because a context can be
     taken away and handed back, and then all of it has to be made again. */
  function build() {
    var vs = shader(gl.VERTEX_SHADER, VERT);
    var fs = shader(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return false;

    prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;

    gl.useProgram(prog);
    gl.uniform1f(gl.getUniformLocation(prog, "uR"), 0.5 / PATCH);
    gl.uniform1i(gl.getUniformLocation(prog, "uTex"), 0);
    gl.uniform1i(gl.getUniformLocation(prog, "uText"), 1);

    var quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    tex     = makeTex(gl.TEXTURE0);
    textTex = makeTex(gl.TEXTURE1);
    gl.activeTexture(gl.TEXTURE0);

    gl.viewport(0, 0, canvas.width, canvas.height);
    paintLabel(canvas.width);
    return true;
  }

  /* --- the label, as a mask ----------------------------------------- */

  /* Drawn white on nothing: only the alpha is read, and the shader turns
     that into an inversion rather than a fill. */
  function paintLabel(px) {
    if (!textTex || !(px > 2)) return;

    tcan.width = tcan.height = px;
    tctx.clearRect(0, 0, px, px);

    var fs = px * 0.17;
    var track = fs * 0.14;
    tctx.fillStyle = "#fff";
    tctx.textAlign = "left";
    tctx.textBaseline = "alphabetic";
    var spaced = "letterSpacing" in tctx;
    if (spaced) tctx.letterSpacing = track + "px";
    tctx.font = '700 ' + fs + 'px "Space Grotesk", system-ui, sans-serif';

    /* Centre on the ink, not on the metrics. Tracking adds a space after
       the last letter that the advance width counts and the eye does not,
       and "middle" centres the font's em box rather than the caps sitting
       in it — both push the word off-centre inside a circle. */
    var m = tctx.measureText(LABEL);
    var w = m.width - (spaced ? track : 0);
    var top = m.actualBoundingBoxAscent;
    var bottom = m.actualBoundingBoxDescent;
    var x = (px - w) / 2;
    var y = isFinite(top) ? (px + top - bottom) / 2 : px / 2;
    tctx.fillText(LABEL, x, y);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, textTex);
    // canvas rows run top-down and texture rows run bottom-up: without
    // this the label is drawn upside down
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tcan);
    gl.activeTexture(gl.TEXTURE0);
  }

  /* --- state -------------------------------------------------------- */

  var on = false;                // the pointer is on the card in front
  var raf = 0;                   // pending frame, 0 when none
  var until = 0;                 // keep painting this long past the last hide
  var snap = false;              // next frame arrives under the pointer
  var want = { x: 0, y: 0 };     // pointer, in client space
  var at   = { x: 0, y: 0 };     // where the lens has got to, in deck space
  var size = 0;                  // lens diameter in CSS px
  var radii = [];                // each card's corner radius, in CSS px

  function measure() {
    var w = box.getBoundingClientRect().width;
    if (!w) return;              // out of layout: there is nothing true to read
    size = w;

    radii = cards.map(function (c) {
      return parseFloat(getComputedStyle(c).borderTopLeftRadius) || 0;
    });

    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var px = Math.max(2, Math.round(size * dpr));
    if (canvas.width === px) return;
    canvas.width = canvas.height = px;
    gl.viewport(0, 0, px, px);
    paintLabel(px);
  }

  /* work.js writes this on every card on every frame. */
  function litness(card) {
    var o = card.style.opacity;
    return o === "" ? 1 : (parseFloat(o) || 0);
  }

  /* The card in front: the most lit one still on the deck. Read from the
     deck rather than from `.is-current`, so a frame in which work.js has
     not marked anything cannot leave the lens with nothing to sit on. */
  function front() {
    var best = null, top = -1;
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].style.visibility === "hidden") continue;
      var o = litness(cards[i]);
      if (o > top) { top = o; best = cards[i]; }
    }
    return best;
  }

  /* What a card is actually showing: the photograph once it has resolved,
     the coarse blocks while it has not. Magnifying the photograph over a
     card that is still made of blocks is the one mismatch the glass can
     never explain away. */
  function shown(card) {
    if (!card.classList.contains("is-sharp")) {
      var px = card.querySelector(".card__px");
      if (px && px.width > 1) return { el: px, w: px.width, h: px.height, smooth: false };
    }
    var img = card.querySelector("img");
    if (img && img.naturalWidth) {
      return { el: img, w: img.naturalWidth, h: img.naturalHeight, smooth: true };
    }
    return null;
  }

  /* Everything under the glass, composited into the patch.

     The deck is drawn again at patch scale: the black it sits on, then
     each card that reaches the patch, in its own place, at its own
     opacity, clipped to its own corners. Nearly every card is culled by
     the overlap test, so this is one or two draws — and at a card change,
     when the glass hangs across the seam, it is the two the eye can see. */
  function grab(d) {
    var span = size * PATCH;                   // patch side, in CSS px
    var x0 = at.x - span / 2;                  // patch origin, in deck space
    var y0 = at.y - span / 2;
    var k = TEX / span;                        // deck px → patch px

    pctx.setTransform(1, 0, 0, 1, 0, 0);
    pctx.globalAlpha = 1;
    pctx.fillStyle = VOID;
    pctx.fillRect(0, 0, TEX, TEX);
    pctx.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);

    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      if (card.style.visibility === "hidden") continue;

      var op = litness(card);
      if (op < 0.004) continue;

      // the rect already carries the deck's perspective, so a card set
      // back along z lands here at the size it is drawn on screen
      var r = card.getBoundingClientRect();
      var L = r.left - d.left, T = r.top - d.top;
      if (!r.width || L > x0 + span || L + r.width < x0 ||
          T > y0 + span || T + r.height < y0) continue;

      pctx.save();
      pctx.globalAlpha = op;
      pctx.beginPath();
      if (pctx.roundRect) pctx.roundRect(L, T, r.width, r.height, radii[i] || 0);
      else pctx.rect(L, T, r.width, r.height);
      pctx.clip();
      pctx.fillStyle = CARD;
      pctx.fillRect(L, T, r.width, r.height);

      var src = shown(card);
      if (src) {
        var s = Math.max(r.width / src.w, r.height / src.h);   // object-fit: cover
        var sw = r.width / s, sh = r.height / s;
        pctx.imageSmoothingEnabled = src.smooth;
        pctx.drawImage(src.el, (src.w - sw) / 2, (src.h - sh) / 2, sw, sh,
                       L, T, r.width, r.height);
      }
      pctx.restore();
    }

    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);   // canvas is top-down, GL is bottom-up
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, patch);
  }

  function render() {
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, textTex);
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function wipe() {
    if (lost || !prog) return;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  function stop() {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    wipe();                      // never leave a frame behind to be shown again
  }

  function frame(now) {
    /* Booked before anything else can happen. Every early return below
       is a frame skipped, not a run ended: the alternative is a lens
       frozen on screen still magnifying a project that has scrolled by. */
    raf = requestAnimationFrame(frame);

    if (!on && now > until) { stop(); return; }

    var d = deck.getBoundingClientRect();
    if (!d.width || !size) { hide(); return; }   // out of layout: a case is open

    // the pointer is kept in client space and converted here, so the lens
    // stays under the cursor even on the frames where the deck itself moves
    var tx = want.x - d.left, ty = want.y - d.top;
    if (snap) { at.x = tx; at.y = ty; snap = false; }
    else { at.x += (tx - at.x) * EASE; at.y += (ty - at.y) * EASE; }
    box.style.transform = "translate3d(" + at.x + "px," + at.y + "px,0)";

    if (lost || !prog) return;
    try {
      grab(d);
      render();
    } catch (e) { /* a bad frame must not end the run */ }
  }

  function pump() {
    if (!raf) raf = requestAnimationFrame(frame);
  }

  /* --- pointer ------------------------------------------------------ */

  function place(e) {
    want.x = e.clientX;
    want.y = e.clientY;
  }

  /* Live only while the pointer is actually over the front card — the
     space above and below it belongs to the neighbours, and the lens has
     no business there. */
  function over(e) {
    var card = front();
    if (!card) return false;
    var r = card.getBoundingClientRect();
    return !!r.width &&
           e.clientX >= r.left && e.clientX <= r.right &&
           e.clientY >= r.top  && e.clientY <= r.bottom;
  }

  function show(e) {
    measure();
    place(e);
    snap = true;                         // arrive under the pointer, not from a corner
    on = true;
    document.body.classList.add("lens-on");
    box.classList.add("is-on");
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    frame(performance.now());            // paint now, never a blank first frame
  }

  function hide() {
    if (on) { on = false; until = performance.now() + FADE; }
    document.body.classList.remove("lens-on");
    box.classList.remove("is-on");
  }

  deck.addEventListener("pointermove", function (e) {
    if (e.pointerType !== "mouse") return;
    if (!over(e)) { hide(); return; }
    if (!on) { show(e); return; }
    place(e);
    pump();          // if the run ever stopped anyway, a move brings it back
  });

  deck.addEventListener("pointerleave", hide);

  /* The page runs several WebGL scenes at once. If the browser takes this
     context back, the canvas keeps its last frame on screen — which is
     exactly the frozen-lens failure, arrived at from the other side. Hide
     it, and rebuild if the context comes back. */
  canvas.addEventListener("webglcontextlost", function (e) {
    e.preventDefault();                  // without this it is never restored
    lost = true;
    prog = tex = textTex = null;
    hide();
  });
  canvas.addEventListener("webglcontextrestored", function () {
    lost = !build();
  });

  /* A case view puts the landing page out of layout, and a hidden tab
     stops the clock. Either way the lens has nothing honest to show. */
  addEventListener("hs:home", hide);
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) hide();
  });

  addEventListener("resize", measure);

  measure();
  if (!build()) { box.remove(); return; }

  // the label is cut from a real typeface, so it has to be redrawn once
  // the face has actually arrived
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { paintLabel(canvas.width); });
  }
})();
