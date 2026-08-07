import type { ReactNode } from "react";

type Props = {
  title: string;
  /** Shown next to the title when the section is shut, so a fold still tells you its state. */
  summary?: string;
  defaultOpen?: boolean;
  children: ReactNode;
};

/**
 * One foldable group in a tool rail.
 *
 * Built on `<details>` rather than a state hook: the browser already knows how to open and close
 * one, gives it keyboard operation and the right semantics for a screen reader, and remembers
 * nothing we would have to synchronise.
 *
 * A shut section still shows its current value in the summary line — a rail folded down to titles
 * is tidy but useless if you have to open each one to see what is selected.
 */
export function RailSection({ title, summary, defaultOpen = true, children }: Props) {
  return (
    <details open={defaultOpen} className="@group @border-b @border-white/5 @pb-3 last:@border-b-0">
      <summary className="@flex @cursor-pointer @list-none @items-center @justify-between @gap-2 @py-2">
        <span className="@font-mono @text-[0.65rem] @uppercase @tracking-widest @text-white/40 group-hover:@text-white/70">
          {title}
        </span>

        <span className="@flex @items-center @gap-1.5">
          {summary !== undefined && (
            <span className="@max-w-[7rem] @truncate @text-[0.65rem] @text-white/35">
              {summary}
            </span>
          )}
          {/* Rotates when the section opens; the marker is hidden by list-none above. */}
          <svg
            viewBox="0 0 12 12"
            aria-hidden="true"
            className="@h-2.5 @w-2.5 @text-white/30 @transition-transform group-open:@rotate-90"
          >
            <path d="M4 2 8 6 4 10" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </span>
      </summary>

      <div className="@pt-1">{children}</div>
    </details>
  );
}
