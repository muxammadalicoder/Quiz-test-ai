import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Mic, Send, Square, Volume2 } from "lucide-react";
import { api } from "./api";
import { canRecord, speak, startClip, stopSpeak, unlockAudio, voiceError } from "./voice";

type Message = { role: "user" | "assistant"; text: string };
export default function Chat({ onExit }: { onExit: () => void }) {
  const [messages, setMessages] = useState<Message[]>([{ role: "assistant", text: "Salom! Men Quiz Arena o‘zbekcha AI yordamchisiman. Savolingizni yozing yoki mikrofon orqali gapiring." }]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [hint, setHint] = useState("");
  const clipRef = useRef<{ stop: () => void } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, hint]);
  useEffect(() => () => { clipRef.current?.stop(); stopSpeak(); }, []);

  async function send(text: string, audio?: { b64: string; mime: string }) {
    const trimmed = text.trim();
    if ((!trimmed && !audio) || busy) return;
    unlockAudio(); stopSpeak(); setBusy(true); setHint("AI o‘ylayapti…"); setDraft("");
    const next = trimmed ? [...messages, { role: "user" as const, text: trimmed }] : messages;
    if (trimmed) setMessages(next);
    try {
      const history = messages.slice(-10).map(m => ({ role: m.role, text: m.text }));
      const d = await api<{ text: string }>("/api/ai/chat", { body: { text: trimmed, audio: audio?.b64, mime: audio?.mime, history } });
      const updated = [...next, { role: "assistant" as const, text: d.text }];
      setMessages(updated); setHint("Javobni ovoz chiqarib aytyapman…");
      await speak(d.text, true);
      setHint(voiceError ? `Matn tayyor, lekin Gemini ovozi ishlamadi: ${voiceError}` : "");
    } catch (e: any) { setHint(e?.message || "Ulanishda xato yuz berdi."); }
    finally { setBusy(false); }
  }

  async function toggleMic() {
    if (busy) return;
    if (clipRef.current) { clipRef.current.stop(); return; }
    if (!canRecord) { setHint("Bu iPhone/Telegram brauzerida ovoz yozish ishlamayapti. Matn yozib yuboring."); return; }
    try {
      unlockAudio(); stopSpeak(); setHint("Gapiring, tugagach yozuv avtomatik to‘xtaydi…"); setRecording(true);
      const clip = await startClip(15000); clipRef.current = clip;
      const audio = await clip.done; clipRef.current = null; setRecording(false);
      if (!audio.b64) { setHint("Ovoz yozilmadi. Qayta urinib ko‘ring."); return; }
      const voiceMessage = { role: "user" as const, text: "🎙️ Ovozli xabar" };
      setMessages(prev => [...prev, voiceMessage]);
      await send("", audio);
    } catch (e: any) { clipRef.current = null; setRecording(false); setHint(e?.name === "NotAllowedError" ? "Mikrofonga ruxsat bering va qayta urinib ko‘ring." : (e?.message || "Mikrofon ishlamadi.")); }
  }

  return <section className="stack" style={{ minHeight: "65vh" }}>
    <div className="row between center-row"><button className="ghost sm" onClick={onExit}><ArrowLeft size={16}/> Orqaga</button><b>🎙 O‘zbekcha AI suhbat</b><button className="icon-btn" aria-label="Ovozni to‘xtatish" onClick={stopSpeak}><Square size={15}/></button></div>
    <div className="stack" style={{ flex: 1, maxHeight: "55vh", overflowY: "auto", padding: 4 }}>
      {messages.map((m, i) => <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "88%", padding: "10px 13px", borderRadius: 14, background: m.role === "user" ? "var(--accent, #343b70)" : "var(--panel, #171a2b)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{m.text}{m.role === "assistant" && <button className="icon-btn" title="Ovozda qayta eshitish" onClick={() => { unlockAudio(); speak(m.text, true).then(() => setHint(voiceError ? "Gemini ovozi ishlamadi: " + voiceError : "")); }}><Volume2 size={14}/></button>}</div>)}
      <div ref={bottomRef}/>
    </div>
    {hint && <small className="muted center-t">{hint}</small>}
    <form className="row gap-s center-row" onSubmit={e => { e.preventDefault(); send(draft); }}>
      <input style={{ flex: 1, minWidth: 0 }} value={draft} onChange={e => setDraft(e.target.value)} placeholder="O‘zbekcha yozing…" disabled={busy || recording}/>
      <button className={`icon-btn ${recording ? "on" : ""}`} type="button" aria-label={recording ? "Yozuvni tugatish" : "Ovoz yozish"} disabled={busy} onClick={toggleMic}>{recording ? <Square size={18}/> : <Mic size={18}/>}</button>
      <button className="primary" type="submit" disabled={busy || !draft.trim()} aria-label="Yuborish"><Send size={17}/></button>
    </form>
    <small className="muted center-t">Ovoz Gemini API orqali yaratiladi. API xato bersa, brauzerning turkcha ovoziga avtomatik o‘tmaydi.</small>
  </section>;
}
