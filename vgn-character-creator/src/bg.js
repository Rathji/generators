// ============================================================================
//  src/bg.js — subtle synthwave backdrop for the forge screen
//  ----------------------------------------------------------------------------
//  Drifting starfield + faint neon grid drawn behind every overlay, so the
//  "cabinet" never looks empty even though there's no game world anymore.
//  ============================================================================

export function startBG(canvas) {
  const ctx = canvas.getContext('2d');
  const COLORS = ['255,210,62', '45,225,255', '255,45,149', '255,255,255'];
  const N = 140;
  const stars = [];
  let W = 0, H = 0, dpr = 1, raf = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, canvas.clientWidth * dpr);
    H = Math.max(1, canvas.clientHeight * dpr);
    canvas.width = W;
    canvas.height = H;
  }

  function spawn(i) {
    stars[i] = {
      x: Math.random(),
      y: Math.random(),
      s: Math.random() * 1.8 + 0.4,
      sp: Math.random() * 0.00035 + 0.0001,
      c: COLORS[Math.floor(Math.random() * COLORS.length)],
    };
  }

  function tick() {
    ctx.clearRect(0, 0, W, H);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0a0420');
    g.addColorStop(1, '#140a2e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // faint grid
    ctx.strokeStyle = 'rgba(45,225,255,0.05)';
    ctx.lineWidth = 1;
    const gs = 46 * dpr;
    ctx.beginPath();
    for (let x = 0; x <= W; x += gs) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = 0; y <= H; y += gs) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();

    // stars
    const t = Date.now();
    for (let i = 0; i < N; i++) {
      const st = stars[i];
      st.y += st.sp;
      if (st.y > 1.02) { spawn(i); st.y = 0; }
      const tw = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t / 420 + i * 1.7));
      ctx.fillStyle = `rgba(${st.c},${tw.toFixed(3)})`;
      ctx.fillRect(st.x * W, st.y * H, st.s * dpr, st.s * dpr);
    }

    raf = requestAnimationFrame(tick);
  }

  for (let i = 0; i < N; i++) spawn(i);

  resize();
  window.addEventListener('resize', resize);
  raf = requestAnimationFrame(tick);

  return () => cancelAnimationFrame(raf);
}
