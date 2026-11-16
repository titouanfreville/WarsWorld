"use client";
import { useState } from "react";

/**
 * Surrender confirmation. Conceding is instant and unrecoverable — it ends the match and, in a ranked
 * game, moves MMR — so it asks for the word to be typed out rather than offering a button a misclick
 * could find. The typing is the whole point: it's friction, deliberately.
 *
 * Purely presentational. The parent owns the mutation; this only decides when the intent is
 * unambiguous enough to hand back.
 */
type Props = {
  onConfirm: () => void;
  onCancel: () => void;
  /** True while the surrender is in flight — keeps the button from being pressed twice. */
  pending: boolean;
};

const REQUIRED = "surrender";

export function SurrenderConfirm({ onConfirm, onCancel, pending }: Props) {
  const [typed, setTyped] = useState("");
  // Case- and whitespace-insensitive: the confirmation is about intent, not typing accuracy.
  const matches = typed.trim().toLowerCase() === REQUIRED;

  return (
    <div className="@fixed @inset-0 @z-50 @flex @items-center @justify-center @p-4">
      <button
        aria-label="Cancel surrender"
        className="@absolute @inset-0 @bg-black/70 @backdrop-blur-sm"
        onClick={onCancel}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="surrender-title"
        className="@relative @w-full @max-w-sm @rounded-lg @border @border-red-500/30 @bg-bg-primary @p-5 @shadow-2xl @shadow-black/60"
      >
        <h2
          id="surrender-title"
          className="@font-russoOne @text-lg @uppercase @tracking-widest @text-red-300"
        >
          Surrender
        </h2>

        <p className="@mt-2 @text-sm @leading-relaxed @text-slate-300">
          This ends the match immediately and hands your opponent the win. It can&apos;t be undone,
          and any rating change is final.
        </p>

        <label
          htmlFor="surrender-input"
          className="@mt-4 @block @text-xs @uppercase @tracking-wide @text-slate-500"
        >
          Type <span className="@font-mono @text-slate-300">{REQUIRED}</span> to confirm
        </label>

        <input
          id="surrender-input"
          type="text"
          value={typed}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && matches && !pending) {
              onConfirm();
            }

            if (event.key === "Escape") {
              onCancel();
            }
          }}
          className="@mt-1 @w-full @rounded @border @border-white/15 @bg-black/40 @px-3 @py-2 @font-mono @text-sm @text-slate-100 @outline-none focus:@border-red-500/60"
        />

        <div className="@mt-4 @flex @justify-end @gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="@rounded @px-3 @py-2 @font-russoOne @text-xs @uppercase @tracking-wide @text-slate-400 @transition hover:@text-slate-200"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!matches || pending}
            onClick={onConfirm}
            className="@rounded @bg-red-600 @px-4 @py-2 @font-russoOne @text-xs @uppercase @tracking-wide @text-white @transition hover:@bg-red-500 disabled:@cursor-not-allowed disabled:@bg-slate-700 disabled:@text-slate-500"
          >
            {pending ? "Surrendering…" : "Surrender"}
          </button>
        </div>
      </div>
    </div>
  );
}
