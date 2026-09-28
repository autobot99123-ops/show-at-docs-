/**
 * ShowAt Docs — calm linked-particle field (Canvas2D fallback backend).
 *
 * Same visual language as the WebGPU backend (soft white/gray dots, thin
 * lines, rare ShowAt-green accents, gentle cursor response) for browsers
 * without WebGPU. Small counts + spatial hashing keep it cheap.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} opts
 */
export function startFallback(canvas, opts) {
  const { count, reduceMotion } = opts;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { stop() {} };
  }

  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  let w = 0;
  let h = 0;
  const resize = () => {
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();

  const rnd = (a, b) => a + Math.random() * (b - a);
  const parts = [];
  for (let i = 0; i < count; i++) {
    const green = Math.random() < 0.12;
    parts.push({
      x: rnd(0, w),
      y: rnd(0, h),
      vx: rnd(-6, 6),
      vy: rnd(-6, 6),
      r: rnd(1, 1.9),
      green,
      shade: green ? null : rnd(0.35, 0.7),
    });
  }

  const mouse = { x: -9999, y: -9999 };
  const onMove = (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  };
  const onLeave = () => {
    mouse.x = -9999;
    mouse.y = -9999;
  };
  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("pointerleave", onLeave);
  window.addEventListener("resize", resize);

  const LINK = 130;
  const cell = LINK;
  let raf = 0;
  let last = 0;

  function frame(t) {
    raf = 0;
    const dt = Math.min(0.05, (t - last) / 1000 || 0.016);
    last = t;
    ctx.clearRect(0, 0, w, h);

    // Spatial hash so neighbor checks stay cheap.
    const grid = new Map();
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const key = Math.floor(p.x / cell) + ":" + Math.floor(p.y / cell);
      let bucket = grid.get(key);
      if (!bucket) {
        bucket = [];
        grid.set(key, bucket);
      }
      bucket.push(i);
    }

    for (const p of parts) {
      // Gentle drift + faint wander.
      p.x += (p.vx + Math.sin(t / 2400 + p.y / 140) * 3) * dt;
      p.y += (p.vy + Math.cos(t / 2600 + p.x / 150) * 3) * dt;
      // Gentle cursor push, capped.
      const dx = p.x - mouse.x;
      const dy = p.y - mouse.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < 120 * 120 && d2 > 4) {
        const d = Math.sqrt(d2);
        const f = ((1 - d / 120) * 26 * dt) / d;
        p.vx += dx * f;
        p.vy += dy * f;
      }
      p.vx *= 0.985;
      p.vy *= 0.985;
      if (p.x < -10) p.x = w + 10;
      if (p.x > w + 10) p.x = -10;
      if (p.y < -10) p.y = h + 10;
      if (p.y > h + 10) p.y = -10;
    }

    // Links.
    ctx.lineWidth = 1;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const cx = Math.floor(p.x / cell);
      const cy = Math.floor(p.y / cell);
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        for (let gy = cy - 1; gy <= cy + 1; gy++) {
          const bucket = grid.get(gx + ":" + gy);
          if (!bucket) {
            continue;
          }
          for (const j of bucket) {
            if (j <= i) {
              continue;
            }
            const q = parts[j];
            const dx = p.x - q.x;
            const dy = p.y - q.y;
            const d2 = dx * dx + dy * dy;
            if (d2 > LINK * LINK || d2 < 0.01) {
              continue;
            }
            const a = (1 - Math.sqrt(d2) / LINK) * 0.22;
            const violet = p.green || q.green;
            ctx.strokeStyle = violet
              ? "rgba(139,92,246," + a.toFixed(3) + ")"
              : "rgba(200,205,212," + a.toFixed(3) + ")";
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            ctx.stroke();
          }
        }
      }
    }

    // Dots.
    for (const p of parts) {
      ctx.fillStyle = p.green
        ? "rgba(139,92,246,0.75)"
        : "rgba(210,214,220," + p.shade.toFixed(2) + ")";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, 6.2832);
      ctx.fill();
    }
  }

  const loop = (t) => {
    frame(t);
    raf = requestAnimationFrame(loop);
  };

  const onVisibility = () => {
    if (document.hidden) {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    } else if (!reduceMotion && !raf) {
      last = performance.now();
      raf = requestAnimationFrame(loop);
    }
  };
  document.addEventListener("visibilitychange", onVisibility);

  if (reduceMotion) {
    frame(1000);
  } else {
    last = performance.now();
    raf = requestAnimationFrame(loop);
  }

  return {
    stop() {
      if (raf) {
        cancelAnimationFrame(raf);
      }
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("resize", resize);
    },
  };
}
