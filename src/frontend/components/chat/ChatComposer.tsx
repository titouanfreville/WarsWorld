import { useState } from "react";

/**
 * The shared message composer — one input + Send button used by every chat surface. Owns its own
 * draft state and clears on submit; the call site just receives the finished text via `onSend`.
 * Enter submits (Shift+Enter is left alone for callers that later want multiline). Send is disabled
 * on an empty draft or while `sending`/`disabled`.
 */
export function ChatComposer({
  onSend,
  placeholder = "Message everyone…",
  sending = false,
  disabled = false,
  maxLength = 500,
  sendLabel = "Send",
}: {
  onSend: (text: string) => void;
  placeholder?: string;
  sending?: boolean;
  /** Hard-disable input + button (e.g. a closed channel or a non-participant viewer). */
  disabled?: boolean;
  maxLength?: number;
  sendLabel?: string;
}) {
  const [draft, setDraft] = useState("");

  const submit = () => {
    const trimmed = draft.trim();

    if (trimmed === "" || sending || disabled) {
      return;
    }

    onSend(trimmed);
    setDraft("");
  };

  return (
    <div className="@flex @items-center @gap-2">
      <input
        className="@w-full @min-w-0 @rounded-lg @bg-black/30 @px-2.5 @py-1.5 @text-sm @text-slate-100 @outline @outline-1 @outline-white/10 @transition placeholder:@text-slate-600 focus:@outline-primary disabled:@opacity-50"
        value={draft}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <button
        type="button"
        className="@flex-none @rounded-lg @bg-primary @px-3 @py-1.5 @font-russoOne @text-[11px] @uppercase @tracking-wide @text-black @transition hover:@brightness-110 disabled:@opacity-40 disabled:@cursor-not-allowed"
        disabled={draft.trim() === "" || sending || disabled}
        onClick={submit}
      >
        {sendLabel}
      </button>
    </div>
  );
}
