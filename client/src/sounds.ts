const KEY = "quiz-arena-sounds";
let context: AudioContext | null = null;
let musicTimer: ReturnType<typeof setTimeout> | null = null;
let musicStep = 0;
let musicStarted = false;
let musicMode: "background" | "test" = "background";

export function soundsEnabled(): boolean {
  try { return localStorage.getItem(KEY) !== "off"; } catch { return true; }
}
export function setSoundsEnabled(enabled: boolean) {
  try { localStorage.setItem(KEY, enabled ? "on" : "off"); } catch { /* storage ixtiyoriy */ }
  if (!enabled) stopBackgroundMusic();
  else startBackgroundMusic();
}
function getContext(): AudioContext | null {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return null;
    context ||= new Ctx();
    if (context.state === "suspended") void context.resume();
    return context;
  } catch { return null; }
}
function tone(frequency: number, start: number, duration: number, type: OscillatorType = "sine", volume = 0.07) {
  if (!soundsEnabled()) return;
  const ctx = getContext(); if (!ctx) return;
  try {
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(frequency, ctx.currentTime + start);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
    gain.gain.exponentialRampToValueAtTime(volume, ctx.currentTime + start + 0.025);
    gain.gain.setValueAtTime(volume, ctx.currentTime + start + Math.max(0.03, duration - 0.08));
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(ctx.currentTime + start); osc.stop(ctx.currentTime + start + duration + 0.02);
  } catch { /* ovoz qo'llab-quvvatlanmasa o'yin davom etadi */ }
}

// Yengil, sokin videoo'yin uslubidagi fon kuy; tashqi audio fayl talab qilmaydi.
const melody = [523.25, 659.25, 783.99, 659.25, 587.33, 698.46, 880, 698.46, 523.25, 659.25, 783.99, 987.77, 880, 783.99, 659.25, 587.33];
function musicTick() {
  if (!musicStarted || !soundsEnabled()) { stopBackgroundMusic(); return; }
  const backgroundMelody = melody;
  const testMelody = [659.25, 783.99, 987.77, 783.99, 698.46, 880, 1046.5, 880, 659.25, 783.99, 987.77, 1174.66, 1046.5, 987.77, 880, 783.99];
  const activeMelody = musicMode === "test" ? testMelody : backgroundMelody;
  const note = activeMelody[musicStep % activeMelody.length];
  const duration = musicMode === "test" ? 0.30 : 0.42;
  tone(note, 0, duration, musicMode === "test" ? "triangle" : "sine", musicMode === "test" ? 0.014 : 0.012);
  if (musicStep % 4 === 0) tone(note / 2, 0, duration + 0.12, "triangle", 0.006);
  musicStep++;
  musicTimer = setTimeout(musicTick, musicMode === "test" ? 380 : 520);
}
function startMusic(mode: "background" | "test") {
  if (!soundsEnabled()) return;
  if (musicStarted && musicMode === mode) return;
  if (musicTimer) clearTimeout(musicTimer);
  musicMode = mode;
  musicStep = 0;
  musicStarted = true;
  // Brauzer audio'si foydalanuvchi ilk bor tegmaguncha bloklanishi mumkin.
  getContext();
  musicTimer = setTimeout(musicTick, 120);
}
export function startBackgroundMusic() { startMusic("background"); }
export function startTestMusic() { startMusic("test"); }
export function stopTestMusic() { if (musicMode === "test") startBackgroundMusic(); }
export function stopBackgroundMusic() {
  musicStarted = false;
  if (musicTimer) clearTimeout(musicTimer);
  musicTimer = null;
}
export const playClick = () => tone(520, 0, 0.055, "triangle", 0.035);
export const playCorrect = () => { tone(660, 0, 0.12, "sine"); tone(880, 0.11, 0.18, "sine"); };
export const playWrong = () => { tone(240, 0, 0.16, "triangle"); tone(180, 0.13, 0.2, "triangle"); };
export const playFinish = () => { tone(523, 0, 0.14); tone(659, 0.13, 0.14); tone(784, 0.26, 0.14); tone(1047, 0.39, 0.3); };
