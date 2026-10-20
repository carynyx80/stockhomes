import type { Metadata } from "next";

export const metadata: Metadata = { title: "Style guide", robots: { index: false } };

const SWATCHES = [
  ["beige", "#F2E8D5", "Main background"],
  ["parchment", "#E6D6B8", "Cards, panels"],
  ["sand", "#CDB48E", "Borders, dividers"],
  ["oxblood", "#7A0F17", "Buttons, headings, the front door"],
  ["wine", "#4E0A0F", "Hover, pressed, deep shadow"],
  ["brass", "#B08A4A", "Door knob, highlights"],
  ["ink", "#1E1412", "Body text"],
  ["long", "#2F5D3A", "Long, profit"],
  ["short", "#B3261E", "Short, loss"],
] as const;

export default function StyleGuide() {
  return (
    <div className="flex flex-col gap-14 py-12">
      <section>
        <h1 className="editorial text-4xl text-oxblood">Style guide</h1>
        <p className="mt-2 text-ink/70">Internal reference for the design tokens. Not linked from the rooms.</p>
      </section>

      <section>
        <h2 className="text-xs font-semibold uppercase tracking-[0.22em] text-brass">Palette</h2>
        <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {SWATCHES.map(([name, hex, use]) => (
            <li key={name} className="panel overflow-hidden">
              <div className="h-20 border-b border-sand" style={{ background: `var(--${name})` }} />
              <div className="p-3">
                <p className="font-semibold">--{name}</p>
                <p className="numeric text-xs text-ink/60">{hex}</p>
                <p className="mt-1 text-xs text-ink/70">{use}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-6">
        <h2 className="text-xs font-semibold uppercase tracking-[0.22em] text-brass">Type</h2>
        <div>
          <p className="text-xs text-ink/50">Gloock · display</p>
          <p className="display text-7xl text-oxblood">STOXHOMES</p>
        </div>
        <div>
          <p className="text-xs text-ink/50">Fraunces italic, SOFT 100, WONK 1 · room names</p>
          <p className="editorial text-5xl text-oxblood">The Fireplace</p>
        </div>
        <div>
          <p className="text-xs text-ink/50">Bricolage Grotesque · body and UI</p>
          <p className="max-w-xl text-lg">
            Users go long or short on city home prices, with margin and settlement in USDG.
          </p>
        </div>
        <div>
          <p className="text-xs text-ink/50">Martian Mono · every number</p>
          <p className="numeric text-3xl">1,284,903.0042 <span className="text-long">+2.41%</span> <span className="text-short">−0.87%</span></p>
          <p className="numeric mt-1 text-sm text-ink/70">0x000000000000000000000000000000000000dEaD</p>
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-4">
        <h2 className="sr-only">Controls</h2>
        <button type="button" className="btn-oxblood">Primary action</button>
        <span className="numeric rounded bg-long px-3 py-1.5 text-sm text-beige">LONG 25x</span>
        <span className="numeric rounded bg-short px-3 py-1.5 text-sm text-beige">SHORT 10x</span>
        <span className="rounded border border-brass bg-brass/15 px-3 py-1.5 text-sm text-wine">
          Simulated — no real funds.
        </span>
      </section>
    </div>
  );
}
