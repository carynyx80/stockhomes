/** Two soft knocks, synthesised with Web Audio so there is no sound file to ship. */

export function playKnock(): void {
  const Ctx =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();

  const hit = (at: number) => {
    const t = ctx.currentTime + at;

    // Body of the knock: a quickly falling low tone.
    const osc = ctx.createOscillator();
    const tone = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(55, t + 0.09);
    tone.gain.setValueAtTime(0.55, t);
    tone.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    osc.connect(tone).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.16);

    // Knuckle on wood: a short burst of filtered noise.
    const len = Math.floor(ctx.sampleRate * 0.04);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 900;
    const ng = ctx.createGain();
    ng.gain.value = 0.35;
    noise.connect(lp).connect(ng).connect(ctx.destination);
    noise.start(t);
  };

  hit(0);
  hit(0.17);
  window.setTimeout(() => void ctx.close(), 800);
}

const SOUND_KEY = "stoxhomes:sound";

export function loadSoundPref(): boolean {
  try {
    return window.localStorage.getItem(SOUND_KEY) === "on";
  } catch {
    return false;
  }
}

export function saveSoundPref(on: boolean): void {
  try {
    window.localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    // Preference just won't persist.
  }
}
