"use client";

/**
 * The standing reminder that the board is in scrap mode — while it's on, a left-click on one of your
 * units disbands it instead of selecting it.
 *
 * There's no per-click confirmation (that would defeat the point of a mode built for scrapping several
 * units in a row), so this banner is what carries the warning: it stays up for as long as the mode is
 * armed, and offers the way out. Deliberately loud, and pinned over the board rather than tucked in
 * the HUD, because the destructive clicks happen right here.
 */
type Props = {
  onExit: () => void;
};

export function DeleteModeBanner({ onExit }: Props) {
  return (
    <div className="@pointer-events-none @absolute @inset-x-0 @top-2 @z-40 @flex @justify-center">
      <div className="@pointer-events-auto @flex @items-center @gap-2 @rounded @border @border-red-500/70 @bg-black/85 @px-2.5 @py-1 @shadow-md @shadow-black/60">
        <span className="@font-russoOne @text-[10px] @uppercase @tracking-wide @text-red-300">
          Scrap mode — click your units to disband
        </span>
        <button
          type="button"
          onClick={onExit}
          className="@rounded @bg-white/10 @px-2 @py-0.5 @font-russoOne @text-[10px] @uppercase @tracking-wide @text-slate-200 @transition hover:@bg-white/20"
        >
          Done
        </button>
      </div>
    </div>
  );
}
