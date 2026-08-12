/* ===================================================================
   Horizon Symmetry — cover lens

   Over a project cover the pointer is replaced by a glass lens that
   magnifies what is underneath it and carries the word that says what
   clicking does.

   The refraction is real rather than drawn: the patch of the front
   card's image sitting under the lens is copied into a small texture
   each frame and bent through a sphere in the shader — centre magnified,
   rim pushed outward, the three channels separated a little more the
   further out they land. The rim shading and the highlight are the only
   parts that are painted rather than sampled.

   Only the patch travels to the GPU, never the whole image, so the cost
   does not scale with how large the card is.
   =================================================================== */

(function () {
  "use strict";

  /* --- tuning ------------------------------------------------------- */

  var PATCH = 1.5;    // source area copied, as a multiple of the lens
  var TEX   = 512;    // texture the patch is copied into
  var ZOOM  = 1.22;   // magnification at the centre — noticeable, not a telescope
  var BEND  = 0.34;   // outward push, confined to the rim
  var ABERR = 0.008;  // channel separation at the rim — barely there on purpose
  var BLUR  = 0.016;  // how far the rim smears, in patch-UV units
  var EDGE0 = 0.60;   // where the rim band starts
  var EASE  = 0.22;   // how much of the distance to the pointer per frame
  var LABEL = "VIEW";   // size lives in CSS, on .deck

  var deck = document.querySelector(".deck");
  if (!deck) return;

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
    "uniform sampler2D uTex;",    // the cover under the lens
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

  function shader(type, source) {
    var s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  }

  var vs = shader(gl.VERTEX_SHADER, VERT);
  var fs = shader(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) { box.remove(); return; }

  var prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { box.remove(); return; }

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

  var tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  // the patch of cover under the lens, copied here before it is uploaded
  var patch = document.createElement("canvas");
  patch.width = patch.height = TEX;
  var pctx = patch.getContext("2d");

  /* --- the label, as a mask ----------------------------------------- */

  var textTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, textTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.activeTexture(gl.TEXTURE0);

  var tcan = document.createElement("canvas");
  var tctx = tcan.getContext("2d");

  /* Drawn white on nothing: only the alpha is read, and the shader turns
     that into an inversion rather than a fill. */
  function paintLabel(px) {
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

  var on = false, raf = 0;
  var want = { x: 0, y: 0 };     // where the pointer is
  var at   = { x: 0, y: 0 };     // where the lens has got to
  var size = 0;

  function measure() {
    size = box.getBoundingClientRect().width;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var px = Math.max(2, Math.round(size * dpr));
    if (canvas.width !== px) {
      canvas.width = canvas.height = px;
      gl.viewport(0, 0, px, px);
      paintLabel(px);
    }
  }

  /* The front card, or nothing if the deck is mid-move. */
  function front() {
    return deck.querySelector(".card.is-current");
  }

  /* Copy the area under the lens out of the card's image. The image is
     laid out with object-fit: cover, so the crop it is already showing
     has to be undone before the patch can be cut: `s` is that cover
     scale, and it turns a point on the card into a pixel in the file. */
  function grab(card) {
    var img = card.querySelector("img");
    var r = card.getBoundingClientRect();
    var d = deck.getBoundingClientRect();
    if (!r.width || !img || !img.naturalWidth) return false;

    var s = Math.max(r.width / img.naturalWidth, r.height / img.naturalHeight);
    var px = at.x - (r.left - d.left);          // pointer, in card space
    var py = at.y - (r.top - d.top);

    var cx = (img.naturalWidth  - r.width  / s) / 2 + px / s;
    var cy = (img.naturalHeight - r.height / s) / 2 + py / s;
    var span = (size * PATCH) / s;               // patch, in image pixels

    var sx = cx - span / 2, sy = cy - span / 2;
    var x0 = Math.max(0, sx), y0 = Math.max(0, sy);
    var x1 = Math.min(img.naturalWidth, sx + span);
    var y1 = Math.min(img.naturalHeight, sy + span);

    pctx.fillStyle = "#0A0A0C";
    pctx.fillRect(0, 0, TEX, TEX);

    if (x1 > x0 && y1 > y0) {
      var k = TEX / span;
      pctx.drawImage(img, x0, y0, x1 - x0, y1 - y0,
                     (x0 - sx) * k, (y0 - sy) * k, (x1 - x0) * k, (y1 - y0) * k);
    }

    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);   // canvas is top-down, GL is bottom-up
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, patch);
    return true;
  }

  function frame() {
    raf = 0;

    at.x += (want.x - at.x) * EASE;
    at.y += (want.y - at.y) * EASE;
    box.style.transform = "translate3d(" + at.x + "px," + at.y + "px,0)";

    var card = front();
    if (!card || !grab(card)) return;

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

    if (on) raf = requestAnimationFrame(frame);
  }

  /* --- pointer ------------------------------------------------------ */

  function place(e) {
    var d = deck.getBoundingClientRect();
    want.x = e.clientX - d.left;
    want.y = e.clientY - d.top;
  }

  /* Live only while the pointer is actually over the front card — the
     space above and below it belongs to the neighbours, and the lens has
     no business there. */
  function over(e) {
    var card = front();
    if (!card) return false;
    var r = card.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right &&
           e.clientY >= r.top  && e.clientY <= r.bottom;
  }

  function show(e) {
    measure();
    place(e);
    at.x = want.x;                       // arrive under the pointer, not from a corner
    at.y = want.y;
    on = true;
    document.body.classList.add("lens-on");
    box.classList.add("is-on");
    box.style.transform = "translate3d(" + at.x + "px," + at.y + "px,0)";
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    frame();                             // paint now, never a blank first frame
  }

  function hide() {
    on = false;
    document.body.classList.remove("lens-on");
    box.classList.remove("is-on");
    setTimeout(function () {
      if (!on && raf) { cancelAnimationFrame(raf); raf = 0; }
    }, 380);
  }

  deck.addEventListener("pointermove", function (e) {
    if (e.pointerType !== "mouse") return;
    if (!over(e)) { if (on) hide(); return; }
    if (!on) { show(e); return; }
    place(e);
  });

  deck.addEventListener("pointerleave", hide);

  addEventListener("resize", measure);
  measure();

  // the label is cut from a real typeface, so it has to be redrawn once
  // the face has actually arrived
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { paintLabel(canvas.width); });
  }
})();
