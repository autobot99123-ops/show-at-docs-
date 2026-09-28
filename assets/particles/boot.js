/**
 * ShowAt Docs — particle background boot loader.
 *
 * Picks the backend by capability (never by user agent):
 *   WebGPU available -> adapted TSL compute field (linked-field.js)
 *   otherwise        -> calm Canvas2D network (fallback.js)
 * Honors prefers-reduced-motion (single static frame), pauses when the
 * page is hidden, and tiers particle counts by viewport (fewer on mobile).
 */

function tier() {
  const width = window.innerWidth;
  if (width >= 1280) {
    return { gpu: 6144, spawn: 5, cpu: 110 };
  }
  if (width >= 768) {
    return { gpu: 3072, spawn: 3, cpu: 65 };
  }
  return { gpu: 1536, spawn: 2, cpu: 34 };
}

/**
 * World-space influence points so links brighten near doc sections.
 * The field camera sees half-height 7 at z=0; x spans 7*aspect.
 */
function makeAnchorGetter() {
  const halfH = Math.tan((70 * Math.PI) / 360) * 10;
  return () => {
    const aspect = window.innerWidth / window.innerHeight;
    const halfW = halfH * aspect;
    const toWorld = (el, r, w) => {
      if (!el) {
        return null;
      }
      const rect = el.getBoundingClientRect();
      if (rect.bottom < -200 || rect.top > window.innerHeight + 200) {
        return null;
      }
      const nx = ((rect.left + rect.width / 2) / window.innerWidth) * 2 - 1;
      const ny = -(((rect.top + rect.height / 2) / window.innerHeight) * 2 - 1);
      return { x: nx * halfW, y: ny * halfH, r, w };
    };
    return [
      toWorld(document.querySelector(".hero h1, .article h1"), 4.5, 0.8),
      toWorld(document.querySelector(".dl-panel, .card-grid, .article .note"), 5.5, 0.55),
      toWorld(document.querySelector(".site-footer"), 6, 0.35),
    ];
  };
}

export async function bootField(canvas) {
  if (!canvas) {
    return null;
  }
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const counts = tier();
  const getAnchors = makeAnchorGetter();

  // Preferred: WebGPU + TSL compute field (adapted reference implementation).
  try {
    if (!window.navigator || !window.navigator.gpu) {
      throw new Error("WebGPU unavailable");
    }
    const { startLinkedField } = await import("./linked-field.js");
    return await startLinkedField(canvas, {
      count: counts.gpu,
      spawnNb: counts.spawn,
      reduceMotion,
      maxDpr: window.innerWidth < 768 ? 1 : 1.5,
      getAnchors,
    });
  } catch {
    // Graceful fallback: calm Canvas2D network. The docs stay fully usable.
    try {
      const { startFallback } = await import("./fallback.js");
      return startFallback(canvas, { count: counts.cpu, reduceMotion });
    } catch {
      return null;
    }
  }
}
