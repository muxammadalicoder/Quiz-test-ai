import { ReactNode, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";

export const AV: Record<string, { emoji: string; name: string; min: number; a: string; b: string; anim: string }> = {
  fox: { emoji: "🦊", name: "Tulki", min: 1, a: "#ff9a3c", b: "#ff5e62", anim: "wiggle" },
  panda: { emoji: "🐼", name: "Panda", min: 1, a: "#9ad1ff", b: "#5b7cfa", anim: "float" },
  tiger: { emoji: "🐯", name: "Yo‘lbars", min: 1, a: "#ffd166", b: "#f59e0b", anim: "bounce" },
  frog: { emoji: "🐸", name: "Baqa", min: 1, a: "#7ee787", b: "#16a34a", anim: "hop" },
  unicorn: { emoji: "🦄", name: "Yakkashox", min: 1, a: "#f0abfc", b: "#8b5cf6", anim: "sway" },
  octopus: { emoji: "🐙", name: "Sakkizoyoq", min: 1, a: "#fb7185", b: "#be185d", anim: "float" },
  monkey: { emoji: "🐵", name: "Maymun", min: 1, a: "#fcd34d", b: "#b45309", anim: "shake" },
  bear: { emoji: "🐻", name: "Ayiq", min: 1, a: "#d6a76f", b: "#7c4a21", anim: "pulse" },
  penguin: { emoji: "🐧", name: "Pingvin", min: 1, a: "#67e8f9", b: "#0369a1", anim: "sway" },
  wolf: { emoji: "🐺", name: "Bo‘ri", min: 2, a: "#94a3b8", b: "#334155", anim: "pulse" },
  lion: { emoji: "🦁", name: "Sher", min: 2, a: "#fbbf24", b: "#dc2626", anim: "bounce" },
  dragon: { emoji: "🐲", name: "Ajdaho", min: 3, a: "#4ade80", b: "#0f766e", anim: "wiggle" },
  ghost: { emoji: "👻", name: "Arvoh", min: 3, a: "#e0e7ff", b: "#6366f1", anim: "float" },
  robot: { emoji: "🤖", name: "Robot", min: 4, a: "#5eead4", b: "#2563eb", anim: "shake" },
  alien: { emoji: "👽", name: "O‘zga sayyoralik", min: 5, a: "#bef264", b: "#7c3aed", anim: "spin" },
  phoenix: { emoji: "🦅", name: "Feniks", min: 7, a: "#fde047", b: "#ea580c", anim: "glow" }
};

export function Avatar({ id, size = 48, ring = false, still = false }: { id: string; size?: number; ring?: boolean; still?: boolean }) {
  const a = AV[id] || AV.fox;
  return (
    <span className={`avatar ${ring ? "ring" : ""}`} style={{ width: size, height: size, fontSize: size * 0.56, background: `linear-gradient(140deg,${a.a},${a.b})` }}>
      <span className={still ? "" : `an-${a.anim}`}>{a.emoji}</span>
    </span>
  );
}

export function Sheet({ open, onClose, children, title }: { open: boolean; onClose: () => void; children: ReactNode; title?: string }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="sheet-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div className="sheet" initial={{ y: 400 }} animate={{ y: 0 }} exit={{ y: 400 }} transition={{ type: "spring", damping: 28, stiffness: 300 }} onClick={e => e.stopPropagation()}>
            <div className="sheet-head"><b>{title}</b><button className="icon-btn" onClick={onClose} aria-label="Yopish"><X size={18} /></button></div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Server soati bilan sinxron teskari sanoq (soniya). */
export function useCountdown(endsAt: number, serverNow: number) {
  const offset = useRef(0);
  useEffect(() => { offset.current = serverNow - Date.now(); }, [serverNow]);
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!endsAt) { setLeft(0); return; }
    const tick = () => setLeft(Math.max(0, (endsAt - (Date.now() + offset.current)) / 1000));
    tick(); const t = setInterval(tick, 100); return () => clearInterval(t);
  }, [endsAt]);
  return left;
}

export function TimerBar({ left, total }: { left: number; total: number }) {
  const pct = total ? Math.max(0, Math.min(100, (left / total) * 100)) : 0;
  return (
    <div className={`timer ${left <= 5 ? "urgent" : ""}`}>
      <div className="timer-track"><div style={{ width: pct + "%" }} /></div>
      <b>{Math.ceil(left)}</b>
    </div>
  );
}

export function Confetti() {
  const pieces = useRef(Array.from({ length: 46 }, (_, i) => ({
    left: Math.random() * 100, delay: Math.random() * 2.5, dur: 3 + Math.random() * 2.5,
    color: ["#a78bfa", "#5dd7f0", "#ffd166", "#5fe2a1", "#ff7a8a"][i % 5], rot: Math.random() * 360
  }))).current;
  return (
    <div className="confetti" aria-hidden>
      {pieces.map((p, i) => <i key={i} style={{ left: p.left + "%", animationDelay: p.delay + "s", animationDuration: p.dur + "s", background: p.color, transform: `rotate(${p.rot}deg)` }} />)}
    </div>
  );
}

type Row = { id: string; name: string; avatar: string; score: number };
/** 1-2-3 o'rinlar sahnasi: pog'onalar ketma-ket ko'tariladi, g'olib toj bilan. */
export function Podium({ top }: { top: Row[] }) {
  const order = [top[1], top[0], top[2]]; // 2 - 1 - 3
  const rank = [2, 1, 3]; const h = [120, 168, 92]; const medal = ["🥈", "🥇", "🥉"]; const delay = [0.9, 1.8, 0.2];
  return (
    <div className="podium">
      {order.map((p, i) => p ? (
        <motion.div key={p.id} className={`pod pod-${rank[i]}`} initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: delay[i], type: "spring", damping: 14 }}>
          {rank[i] === 1 && <motion.span className="crown" animate={{ y: [0, -6, 0], rotate: [-6, 6, -6] }} transition={{ repeat: Infinity, duration: 2 }}>👑</motion.span>}
          <Avatar id={p.avatar} size={rank[i] === 1 ? 76 : 58} ring={rank[i] === 1} />
          <b className="pod-name">{p.name}</b>
          <small>{p.score} ball</small>
          <motion.div className="pod-bar" initial={{ height: 0 }} animate={{ height: h[i] }} transition={{ delay: delay[i] + 0.1, duration: 0.7, ease: "easeOut" }}>
            <span>{medal[i]}</span><em>{rank[i]}</em>
          </motion.div>
        </motion.div>
      ) : <div key={i} className="pod empty" />)}
    </div>
  );
}

export type ReviewItem = { text: string; options: string[]; correct: number; picked: number };
/** Javoblar tahlili: to'g'ri javob yashil, sizning xato javobingiz qizil. Test tugagandan keyin ko'rsatiladi. */
export function Review({ items }: { items?: ReviewItem[] }) {
  const [open, setOpen] = useState(false);
  if (!items?.length) return null;
  const ok = items.filter(r => r.picked === r.correct).length;
  return (
    <div className="review">
      <button className="ghost" onClick={() => setOpen(o => !o)}>📝 Javoblar tahlili ({ok}/{items.length} to‘g‘ri) {open ? "▲" : "▼"}</button>
      {open && items.map((r, i) => (
        <div key={i} className="rv-card">
          <b>{i + 1}. {r.text}</b>
          {r.options.map((o, k) => (
            <div key={k} className={`rv-opt ${k === r.correct ? "right" : r.picked === k ? "wrong" : ""}`}>
              <span>{"ABCD"[k]}</span><em>{o}</em>
              {k === r.correct && <small>✅ To‘g‘ri javob</small>}
              {k !== r.correct && r.picked === k && <small>❌ Sizning javobingiz</small>}
            </div>
          ))}
          {r.picked < 0 && <small className="muted">Bu savolga javob bermadingiz.</small>}
        </div>
      ))}
    </div>
  );
}

export function Empty({ icon, text }: { icon: string; text: string }) {
  return <div className="empty"><span>{icon}</span><p>{text}</p></div>;
}
