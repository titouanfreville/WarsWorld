import { usePlayers } from "frontend/context/players";
import { DEFAULT_AVATAR, type CoAvatar } from "frontend/utils/sprites/avatar";
import { trpc } from "frontend/utils/trpc-client";
import { useEffect, useState } from "react";
import AvatarBuilder from "./AvatarBuilder";

/**
 * "Edit dossier" — the own-profile editor for the identity slice: profile picture (a CO portrait,
 * built in {@link AvatarBuilder}) and an optional real name. Everything else in the player's
 * preferences is preserved: the whole preferences blob is rewritten on save, so we merge our two
 * fields on top of the current ones (same contract the Settings page uses).
 */

type Props = {
  onClose: () => void;
};

export default function EditProfileModal({ onClose }: Props) {
  const { currentPlayer } = usePlayers();
  const utils = trpc.useUtils();

  const updatePreferences = trpc.user.updatePreferences.useMutation({
    onSuccess: () => {
      void utils.user.me.invalidate();
      void utils.players.profile.invalidate();
      onClose();
    },
  });

  const [avatar, setAvatar] = useState<CoAvatar>(
    currentPlayer?.preferences?.avatar ?? DEFAULT_AVATAR,
  );
  const [realName, setRealName] = useState(currentPlayer?.preferences?.realName ?? "");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  if (currentPlayer === undefined) {
    return null;
  }

  const save = () => {
    const trimmed = realName.trim();
    updatePreferences.mutate({
      playerId: currentPlayer.id,
      ...(currentPlayer.preferences ?? {}),
      avatar,
      realName: trimmed === "" ? undefined : trimmed,
    });
  };

  return (
    <div
      className="@fixed @inset-0 @z-[70] @flex @items-center @justify-center @bg-black/70 @p-4 @backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal
        aria-label="Edit dossier"
        onMouseDown={(event) => event.stopPropagation()}
        className="@w-full @max-w-2xl @overflow-hidden @border @border-primary/50 @bg-bg-primary/95 @shadow-[0_24px_60px_-12px_rgba(0,0,0,0.85)]
          [clip-path:polygon(0_0,100%_0,100%_100%,3%_100%,0_94%)]"
      >
        {/* header */}
        <div className="@flex @items-center @justify-between @border-b @border-primary/25 @bg-gradient-to-r @from-bg-secondary @to-transparent @px-5 @py-3.5">
          <h2 className="@font-russoOne @text-lg @uppercase @tracking-wide @text-white">
            Edit Dossier
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="@text-white/50 @transition-colors hover:@text-primary"
          >
            ✕
          </button>
        </div>

        <div className="@flex @flex-col @gap-6 @px-5 @py-5">
          {/* Real name */}
          <label className="@block">
            <span className="@mb-1.5 @block @text-[10px] @font-bold @uppercase @tracking-[0.25em] @text-primary/80">
              Real name <span className="@text-white/40">(optional)</span>
            </span>
            <input
              value={realName}
              maxLength={60}
              onChange={(event) => setRealName(event.target.value)}
              placeholder="Shown under your callsign"
              className="@w-full @border @border-white/15 @bg-black/40 @px-3 @py-2 @text-sm @text-white @outline-none focus:@border-primary/60"
            />
          </label>

          {/* Profile picture */}
          <div>
            <span className="@mb-2 @block @text-[10px] @font-bold @uppercase @tracking-[0.25em] @text-primary/80">
              Profile picture
            </span>
            <AvatarBuilder value={avatar} onChange={setAvatar} />
          </div>
        </div>

        {/* footer */}
        <div className="@flex @items-center @justify-end @gap-3 @border-t @border-white/10 @bg-black/30 @px-5 @py-3.5">
          {updatePreferences.isError && (
            <span className="@mr-auto @text-xs @text-orange-star">Couldn’t save — try again.</span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="@border @border-white/15 @px-4 @py-1.5 @text-xs @font-semibold @uppercase @tracking-wide @text-white/70 @transition-colors hover:@border-white/40 hover:@text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={updatePreferences.isLoading}
            className="@border @border-primary @bg-primary/20 @px-5 @py-1.5 @text-xs @font-bold @uppercase @tracking-wide @text-white @transition-colors hover:@bg-primary/40 disabled:@opacity-50"
          >
            {updatePreferences.isLoading ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
