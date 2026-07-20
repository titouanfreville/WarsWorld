"use client";

/**
 * The standing reminder that the board is in DEV delete mode — while it's on, a left-click removes
 * whatever unit is under it, the enemy's included.
 *
 * Same reasoning as {@link DeleteModeBanner}, and deliberately worded to distinguish the two: scrap
 * mode submits the normal delete action and only reaches your own units, whereas this reaches the
 * whole board through the dev tools. Two destructive modes that look alike but differ in blast radius
 * need to say which one is armed.
 *
 * There's no per-click confirmation — the mode exists to remove several units in a row — so this
 * banner carries the warning and the way out.
 */
type Props = {
  onExit: () => void;
};

export function DevDeleteModeBanner({ onExit }: Props) {
  return (
    <div className="@pointer-events-none @absolute @inset-x-0 @top-2 @z-40 @flex @justify-center">
      <div className="@pointer-events-auto @flex @items-center @gap-2 @rounded @border @border-red-500/70 @bg-black/85 @px-2.5 @py-1 @shadow-md @shadow-black/60">
        <span className="@font-russoOne @text-[10px] @uppercase @tracking-wide @text-red-300">
          Dev delete — click ANY unit, enemies included
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
