/* ===================================================================
   Horizon Symmetry — mesh mark

   The footer mark is painted onto a grid of vertices rather than laid
   down as an image. Every vertex carries a displacement and a velocity:
   the cursor's motion drags nearby vertices along with it, a spring
   pulls them back to where they belong, and damping settles the rest.
   The mark behaves like cloth that remembers its shape.

   The fringes come from the same displacement. Where a vertex has moved
   far, the fragment samples the mark's alpha slightly to either side and
   lights those offsets in two colours, so the edges split the way a lens
   splits light — but only where the mesh is actually moving.

   Ported from the WebGL2 mesh-text effect; the physics constants are
   the ones from that original.
   =================================================================== */

(function () {
  "use strict";

  /* --- tuning ------------------------------------------------------- */

  var GRID_W  = 96;     // vertices across
  var GRID_H  = 64;     // vertices down
  var FORCE   = 2.1;    // how hard the cursor drags the mesh
  var SPRING  = 0.08;   // pull back toward the rest position
  var DAMPING = 0.9;
  var DT      = 0.1;
  var CHROMA  = 0.005;  // fringe offset, in UV units
  var FIT     = 0.68;   // mark size as a share of the canvas box
  var SLEEP   = 40;     // still frames before the loop parks itself

  // the two fringe colours — brand violet and its light end
  var COLOR_A = [0.608, 0.231, 0.878];   // #9B3BE0
  var COLOR_B = [0.902, 0.769, 0.980];   // #E6C4FA

  var VERT = [
    "#version 300 es",
    "in vec2 aPos;",
    "in vec2 aUv;",
    "in vec2 aDisp;",
    "out vec2 vUv;",
    "out float vMag;",
    "void main() {",
    "  gl_Position = vec4(aPos + aDisp, 0.0, 1.0);",
    "  vUv = aUv;",
    "  vMag = length(aDisp);",
    "}"
  ].join("\n");

  var FRAG = [
    "#version 300 es",
    "precision highp float;",
    "in vec2 vUv;",
    "in float vMag;",
    "out vec4 outColor;",
    "uniform sampler2D uTex;",
    "uniform float uChroma;",
    "uniform vec3 uColorA;",
    "uniform vec3 uColorB;",
    "void main() {",
    "  vec4 base = texture(uTex, vUv);",
    // the fringe only opens where the mesh has actually been pulled
    "  float o = uChroma * clamp(vMag * 8.0, 0.0, 1.0);",
    "  if (o <= 0.0) { outColor = base; return; }",
    "  float aOff = texture(uTex, vUv + vec2(o, 0.0)).a;",
    "  float bOff = texture(uTex, vUv - vec2(o, 0.0)).a;",
    // the texture arrives premultiplied, so base.rgb is already weighted;
    // each fringe lights only the alpha the mark itself does not cover
    "  vec3 col = base.rgb;",
    "  col += uColorA * max(0.0, aOff - base.a);",
    "  col += uColorB * max(0.0, bOff - base.a);",
    "  outColor = vec4(col, max(base.a, max(aOff, bOff)));",
    "}"
  ].join("\n");

  function shader(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (gl.getShaderParameter(s, gl.COMPILE_STATUS)) return s;
    gl.deleteShader(s);
    return null;
  }

  function init(box) {
    var canvas = box.querySelector(".mesh__canvas");
    var img    = box.querySelector(".mesh__img");
    if (!canvas || !img) return;

    if (window.matchMedia &&
        matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    var gl = canvas.getContext("webgl2", {
      alpha: true, premultipliedAlpha: true, antialias: true
    });
    if (!gl) return;                       // the <img> stays as it is

    var vs = shader(gl, gl.VERTEX_SHADER, VERT);
    var fs = shader(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;

    var prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;

    /* --- grid ------------------------------------------------------- */

    var count = (GRID_W + 1) * (GRID_H + 1);
    var pos = new Float32Array(count * 2);
    var uv  = new Float32Array(count * 2);

    for (var y = 0; y <= GRID_H; y++) {
      for (var x = 0; x <= GRID_W; x++) {
        var i = y * (GRID_W + 1) + x;
        var u = x / GRID_W, v = y / GRID_H;
        pos[i * 2]     = u * 2 - 1;
        pos[i * 2 + 1] = 1 - v * 2;
        uv[i * 2]      = u;
        uv[i * 2 + 1]  = v;
      }
    }

    var indices = new Uint32Array(GRID_W * GRID_H * 6);
    var n = 0;
    for (y = 0; y < GRID_H; y++) {
      for (x = 0; x < GRID_W; x++) {
        var a = y * (GRID_W + 1) + x, b = a + 1;
        var c = a + (GRID_W + 1),     d = c + 1;
        indices[n++] = a; indices[n++] = c; indices[n++] = b;
        indices[n++] = b; indices[n++] = c; indices[n++] = d;
      }
    }

    var disp = new Float32Array(count * 2);
    var vel  = new Float32Array(count * 2);

    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    function attrib(name, data, usage) {
      var buf = gl.createBuffer();
      var loc = gl.getAttribLocation(prog, name);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, usage);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      return buf;
    }

    attrib("aPos", pos, gl.STATIC_DRAW);
    attrib("aUv", uv, gl.STATIC_DRAW);
    var dispBuf = attrib("aDisp", disp, gl.DYNAMIC_DRAW);

    var idxBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    var uTex    = gl.getUniformLocation(prog, "uTex");
    var uChroma = gl.getUniformLocation(prog, "uChroma");
    var uA      = gl.getUniformLocation(prog, "uColorA");
    var uB      = gl.getUniformLocation(prog, "uColorB");

    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    /* --- the mark, drawn into the texture --------------------------- */

    var pad = document.createElement("canvas");
    var pctx = pad.getContext("2d");

    function paint() {
      var W = canvas.width, H = canvas.height;
      if (!W || !H || !img.naturalWidth) return;

      pad.width = W;
      pad.height = H;
      pctx.clearRect(0, 0, W, H);

      // contain-fit at FIT, centred — the margin is the room to deform into
      var s = Math.min(W / img.naturalWidth, H / img.naturalHeight) * FIT;
      var w = img.naturalWidth * s, h = img.naturalHeight * s;
      pctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);

      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, pad);
    }

    function resize() {
      var r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var w = Math.max(2, Math.round(r.width * dpr));
      var h = Math.max(2, Math.round(r.height * dpr));
      if (canvas.width === w && canvas.height === h) return;
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
      paint();
    }

    /* --- cursor ----------------------------------------------------- */

    // parked far outside clip space, so nothing is pulled until asked
    var cur = { x: 99, y: 99, px: 99, py: 99, vx: 0, vy: 0, inside: false };

    box.addEventListener("pointermove", function (e) {
      var r = canvas.getBoundingClientRect();
      var x = ((e.clientX - r.left) / r.width) * 2 - 1;
      var y = 1 - ((e.clientY - r.top) / r.height) * 2;
      if (!cur.inside) { cur.px = x; cur.py = y; cur.inside = true; }
      cur.x = x;
      cur.y = y;
      wake();
    });

    box.addEventListener("pointerleave", function () {
      cur.inside = false;
      cur.x = cur.y = 99;
      cur.vx = cur.vy = 0;
    });

    /* --- loop ------------------------------------------------------- */

    var raf = 0, idle = 0, visible = false;

    function wake() {
      idle = 0;
      if (!raf && visible) raf = requestAnimationFrame(frame);
    }

    function frame() {
      raf = 0;

      cur.vx = cur.x - cur.px;
      cur.vy = cur.y - cur.py;
      if (Math.hypot(cur.vx, cur.vy) > 0.3) { cur.vx = 0; cur.vy = 0; }
      cur.px = cur.x;
      cur.py = cur.y;

      var moving = 0;

      for (var i = 0; i < count; i++) {
        var j = i * 2;
        var dx = disp[j], dy = disp[j + 1];

        // proximity falls off fast, so the drag stays local to the cursor
        var cx = cur.x - (pos[j] + dx);
        var cy = cur.y - (pos[j + 1] + dy);
        var prox = Math.max(0, 1 / (1 + Math.hypot(cx, cy) / 0.05) - 0.1);

        var vx = vel[j] + cur.vx * FORCE * prox;
        var vy = vel[j + 1] + cur.vy * FORCE * prox;

        vx = (vx - dx * SPRING) * DAMPING;
        vy = (vy - dy * SPRING) * DAMPING;

        vel[j] = vx;
        vel[j + 1] = vy;

        dx = Math.max(-1, Math.min(1, dx + vx * DT));
        dy = Math.max(-1, Math.min(1, dy + vy * DT));
        disp[j] = dx;
        disp[j + 1] = dy;

        var energy = Math.abs(dx) + Math.abs(dy) + Math.abs(vx) + Math.abs(vy);
        if (energy > moving) moving = energy;
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, dispBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, disp);

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(uTex, 0);
      gl.uniform1f(uChroma, CHROMA);
      gl.uniform3f(uA, COLOR_A[0], COLOR_A[1], COLOR_A[2]);
      gl.uniform3f(uB, COLOR_B[0], COLOR_B[1], COLOR_B[2]);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

      gl.bindVertexArray(vao);
      gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_INT, 0);

      // settled and unattended: stop burning frames until touched again
      idle = (cur.inside || moving > 0.0004) ? 0 : idle + 1;
      if (visible && idle < SLEEP) raf = requestAnimationFrame(frame);
    }

    /* --- boot ------------------------------------------------------- */

    function start() {
      resize();
      paint();
      box.classList.add("is-live");
      // draw the resting mark straight away: the fallback <img> is hidden
      // from this point on, so the canvas must not be empty for a frame
      frame();
    }

    if (img.complete && img.naturalWidth) start();
    else img.addEventListener("load", start, { once: true });

    new ResizeObserver(function () { resize(); wake(); }).observe(canvas);

    if (window.IntersectionObserver) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        if (visible) wake();
      }, { threshold: 0.05 }).observe(box);
    } else {
      visible = true;
    }
  }

  Array.prototype.forEach.call(document.querySelectorAll(".mesh"), init);
})();
