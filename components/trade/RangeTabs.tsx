import type { HistoryRange } from "@/lib/data";

export function RangeTabs({
  ranges,
  value,
  onChange,
  label,
}: {
  ranges: HistoryRange[];
  value: HistoryRange;
  onChange: (r: HistoryRange) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded border border-sand p-0.5">
      {ranges.map((r) => (
        <button
          key={r}
          type="button"
          role="radio"
          aria-checked={value === r}
          onClick={() => onChange(r)}
          className={`numeric rounded-sm px-2.5 py-1 text-xs transition-colors ${
            value === r ? "bg-oxblood text-beige" : "text-ink/70 hover:text-oxblood"
          }`}
        >
          {r}
        </button>
      ))}
    </div>
  );
}
