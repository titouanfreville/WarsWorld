"use client";

/**
 * The standing reminder that the board is in dev teleport mode — while it's on, a left-click picks a
 * unit and the next one drops it there, instead of selecting/moving normally.
 *
 * Same reasoning as {@link DeleteModeBanner}: a mode that silently changes what a click does needs a
 * visible marker and a way out, pinned over the board where the clicks actually happen. It reads the
 * two-step state so the prompt tells you which click you're on, rather than making you remember.
 */
type Props = {
  /** True once a unit is picked — the next click is the destination. */
  hasPickedUnit: boolean;
  onExit: () => void;
};

export function TeleportModeBanner({ hasPickedUnit, onExit }: Props) {
  return (
    <div className="@pointer-events-none @absolute @inset-x-0 @top-2 @z-40 @flex @justify-center">
      <div className="@pointer-events-auto @flex @items-center @gap-2 @rounded @border @border-yellow-500/70 @bg-black/85 @px-2.5 @py-1 @shadow-md @shadow-black/60">
        <span className="@font-russoOne @text-[10px] @uppercase @tracking-wide @text-yellow-300">
          {hasPickedUnit ? "Teleport — click the destination" : "Teleport — click any unit"}
        </span>
        <button
          type="button"
          onClick={onExit}
          className="@rounded @bg-white/10 @px-2 @py-0.5 @font-russoOne @text-[10px] @uppercase @tracking-wide @text-slate-200 @transition hover:@bg-white/20"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
