import { useEffect, useRef } from "react";
import * as THREE from "three";

type Props = { bot?: string; guest: boolean; onGuest: () => void };

/* Scroll bilan boshqariladigan 3D sahna: blok halqasi → tunnel → energiya yadrosi */
function mountScene(canvas: HTMLCanvasElement, reduce: boolean) {
  const R = new THREE.WebGLRenderer({ canvas, antialias: true });
  R.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const S = new THREE.Scene();
  S.background = new THREE.Color(0x07020a);
  S.fog = new THREE.FogExp2(0x1a0408, 0.012);
  const C = new THREE.PerspectiveCamera(60, 1, 0.1, 400);
  const RED = 0xff2b3a, EMB = 0xff7a45;
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

  const ring = new THREE.Group();
  const cubeG = new THREE.BoxGeometry(1, 1, 1), edgeG = new THREE.EdgesGeometry(cubeG);
  const lineM = new THREE.LineBasicMaterial({ color: RED, transparent: true, opacity: 0.9 });
  const fillM = new THREE.MeshBasicMaterial({ color: 0x8a0f1c, transparent: true, opacity: 0.35 });
  for (let i = 0; i < 140; i++) {
    const a = (i / 140) * Math.PI * 2, r = 7 + rnd() * 1.6, s = 0.35 + rnd() * 0.7;
    const g = new THREE.Group();
    g.add(new THREE.LineSegments(edgeG, lineM), new THREE.Mesh(cubeG, fillM));
    g.position.set(Math.cos(a) * r, Math.sin(a) * r, (rnd() - 0.5) * 2.5);
    g.scale.setScalar(s); g.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
    ring.add(g);
  }
  ring.position.set(0, 1.5, 0); S.add(ring);

  const tun = new THREE.Group();
  const bigM = new THREE.LineBasicMaterial({ color: 0xd91f30, transparent: true, opacity: 0.75 });
  const bigF = new THREE.MeshBasicMaterial({ color: 0x4a0a12, transparent: true, opacity: 0.28 });
  for (let j = 0; j < 90; j++) {
    const side = rnd() < 0.5 ? -1 : 1, w = 2 + rnd() * 5, h = 3 + rnd() * 12, d = 2 + rnd() * 4;
    const geo = new THREE.BoxGeometry(w, h, d), b = new THREE.Group();
    b.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), bigM), new THREE.Mesh(geo, bigF));
    b.position.set(side * (5 + rnd() * 9), (rnd() - 0.5) * 16, -14 - j * 1.9);
    tun.add(b);
  }
  S.add(tun);

  const pts: number[] = [];
  for (let k = 0; k < 900; k++) pts.push((rnd() - 0.5) * 60, (rnd() - 0.5) * 40, -rnd() * 230);
  const pg = new THREE.BufferGeometry();
  pg.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  S.add(new THREE.Points(pg, new THREE.PointsMaterial({ color: EMB, size: 0.12, transparent: true, opacity: 0.8 })));

  const core = new THREE.Group(); core.position.set(0, 0, -205);
  const ico = new THREE.Mesh(new THREE.IcosahedronGeometry(4, 1), new THREE.MeshBasicMaterial({ color: RED, wireframe: true }));
  const ico2 = new THREE.Mesh(new THREE.IcosahedronGeometry(2.2, 0), new THREE.MeshBasicMaterial({ color: 0xffb08a, wireframe: true }));
  const orb = new THREE.Group(), sph = new THREE.SphereGeometry(0.12, 6, 6);
  for (let m = 0; m < 60; m++) {
    const p = new THREE.Mesh(sph, new THREE.MeshBasicMaterial({ color: m % 3 ? EMB : 0xffffff }));
    const aa = rnd() * 6.28, bb = rnd() * 3.14, rr = 6 + rnd() * 3;
    p.position.set(rr * Math.sin(bb) * Math.cos(aa), rr * Math.cos(bb), rr * Math.sin(bb) * Math.sin(aa));
    orb.add(p);
  }
  core.add(ico, ico2, orb); S.add(core);

  const size = () => { const w = window.innerWidth, h = window.innerHeight; R.setSize(w, h, false); C.aspect = w / h; C.updateProjectionMatrix(); };
  window.addEventListener("resize", size); size();

  let target = 0, cur = 0, mx = 0, my = 0, raf = 0;
  const bar = document.getElementById("lp-bar"), hint = document.getElementById("lp-hint");
  const onScroll = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    target = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    if (bar) bar.style.width = target * 100 + "%";
    if (hint) hint.style.opacity = window.scrollY > 40 ? "0" : "1";
  };
  const onMove = (e: PointerEvent) => { mx = e.clientX / window.innerWidth - 0.5; my = e.clientY / window.innerHeight - 0.5; };
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("pointermove", onMove, { passive: true });
  onScroll();

  const t0 = performance.now();
  const frame = (now: number) => {
    const t = (now - t0) / 1000;
    cur += (target - cur) * (reduce ? 1 : 0.06);
    const e = cur * cur * (3 - 2 * cur) * 0.35 + cur * 0.65;
    C.position.set(Math.sin(cur * 9) * 1.6 + mx * 1.2, 1.5 * (1 - cur) + Math.cos(cur * 7) * 1.1 - my, 14 - e * 210);
    C.lookAt(C.position.x * 0.3, C.position.y * 0.3, C.position.z - 12);
    if (!reduce) {
      ring.rotation.z = t * 0.12;
      ring.children.forEach(c => { c.rotation.x += 0.003; c.rotation.y += 0.004; });
      ico.rotation.set(t * 0.2, t * 0.4, 0); ico2.rotation.y = -t * 0.7; orb.rotation.y = t * 0.5;
      core.scale.setScalar(1 + Math.sin(t * 2.5) * 0.05);
    }
    lineM.opacity = Math.max(0.15, 0.9 - cur * 3);
    R.render(S, C);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", size);
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("pointermove", onMove);
    S.traverse(o => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      Array.isArray(mat) ? mat.forEach(x => x.dispose()) : mat?.dispose?.();
    });
    R.dispose();
  };
}

export default function Landing({ bot, guest, onGuest }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let off: (() => void) | undefined;
    try { off = mountScene(ref.current, reduce); } catch { /* WebGL yo'q: sahifa 3D'siz ishlaydi */ }
    window.scrollTo(0, 0);
    return () => off?.();
  }, []);

  const tgUrl = bot ? `https://t.me/${bot}` : "";
  const Play = ({ ghost }: { ghost?: boolean }) => (
    <>
      {tgUrl && <a className={`lp-btn ${ghost ? "ghost" : ""}`} href={tgUrl}>Telegram’da o‘ynash</a>}
      {guest && <button className="lp-btn ghost" onClick={onGuest}>Sinov uchun kirish</button>}
    </>
  );

  return (
    <div className="lp">
      <div className="lp-bar" id="lp-bar" />
      <header className="lp-head">
        <a className="lp-logo" href="#lp-top"><i />QUIZ ARENA</a>
        <nav aria-label="Asosiy menyu">
          <a href="#lp-live">Bellashuv</a><a href="#lp-ai">AI</a><a href="#lp-own">Testlar</a><a href="#lp-join">Kirish</a>
        </nav>
      </header>
      <canvas ref={ref} className="lp-canvas" aria-hidden="true" />
      <div className="lp-hint" id="lp-hint">Arenaga kirish uchun pastga suring</div>
      <main className="lp-main" id="lp-top">
        <section className="lp-hero">
          <h1>Bilimingni<br />arenada sina</h1>
          <p>Telegram ichidagi jonli viktorina: test yarating, do‘stlar bilan bellashing, AI bilan ovozli mashq qiling.</p>
          <div className="lp-row"><Play /><a className="lp-btn ghost" href="#lp-live">Imkoniyatlar</a></div>
        </section>
        <section id="lp-live">
          <div className="lp-panel"><span className="lp-count">1 / 3</span><h2>Jonli bellashuv.</h2>
            <p>Xona oching va kodni do‘stlarga yuboring. Hamma bir vaqtda javob beradi, oxirida g‘oliblar podiumi chiqadi.</p></div>
        </section>
        <section id="lp-ai">
          <div className="lp-panel right"><span className="lp-count">2 / 3</span><h2>AI bilan ovozli mashq.</h2>
            <p>AI savolni o‘qiydi, javobingizni tekshiradi va xatoni o‘zbek tilida tushuntiradi.</p></div>
        </section>
        <section id="lp-own">
          <div className="lp-panel"><span className="lp-count">3 / 3</span><h2>O‘z testingiz.</h2>
            <p>Test yarating yoki PDF va DOCX fayldan savollarni avtomatik import qiling. Yakka o‘yin, aralashtirish va yodlash rejimi ham bor.</p></div>
        </section>
        <section className="lp-end" id="lp-join">
          <h2>Arenaga kirishga tayyormisiz?</h2>
          <p>Bepul, Telegram orqali xavfsiz kirish. Reyting va XP sizni kutmoqda.</p>
          <div className="lp-row center"><Play /></div>
          <div className="lp-tags"><span>XP va reyting</span><span>Podium</span><span>Animatsiyali avatarlar</span><span>Yodlash rejimi</span><span>Tez topish</span></div>
        </section>
      </main>
      <footer className="lp-foot">© 2026 Quiz Arena</footer>
    </div>
  );
}
