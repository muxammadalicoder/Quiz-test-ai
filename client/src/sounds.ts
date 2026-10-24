const KEY = "quiz-arena-sounds";
let context: AudioContext | null = null;

export function soundsEnabled(): boolean {
  try { return localStorage.getItem(KEY) !== "off"; } catch { return true; }
}
export function setSoundsEnabled(enabled: boolean) {
  try { localStorage.setItem(KEY, enabled ? "on" : "off"); } catch { /* storage ixtiyoriy */ }
}
function tone(frequency: number, start: number, duration: number, type: OscillatorType = "sine", volume = 0.07) {
  if (!soundsEnabled()) return;
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    context ||= new Ctx();
    if (context.state === "suspended") void context.resume();
    const osc = context.createOscillator(); const gain = context.createGain();
    osc.type = type; osc.frequency.setValueAtTime(frequency, context.currentTime + start);
    gain.gain.setValueAtTime(0.0001, context.currentTime + start);
    gain.gain.exponentialRampToValueAtTime(volume, context.currentTime + start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + start + duration);
    osc.connect(gain); gain.connect(context.destination);
    osc.start(context.currentTime + start); osc.stop(context.currentTime + start + duration + 0.02);
  } catch { /* ovoz qo'llab-quvvatlanmasa o'yin davom etadi */ }
}
export const playClick = () => tone(520, 0, 0.055, "triangle", 0.035);
export const playCorrect = () => { tone(660, 0, 0.12, "sine"); tone(880, 0.11, 0.18, "sine"); };
export const playWrong = () => { tone(240, 0, 0.16, "triangle"); tone(180, 0.13, 0.2, "triangle"); };
export const playFinish = () => { tone(523, 0, 0.14); tone(659, 0.13, 0.14); tone(784, 0.26, 0.14); tone(1047, 0.39, 0.3); };
