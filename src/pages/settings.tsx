import { ParticleField } from "frontend/components/match/hud/ParticleField";
import {
  EFFECT_IDS,
  PARTICLE_EFFECTS,
  readParticleEffect,
  resolveParticleTypes,
  type EffectId,
} from "frontend/components/match/hud/particle-effects";
import { readAnimationScope, type AnimationScope } from "frontend/components/match/animation-scope";
import { usePlayers } from "frontend/context/players";
import { trpc } from "frontend/utils/trpc-client";
import Head from "next/head";
import Link from "next/link";
import { useEffect, useState } from "react";

/** "default" = no personal pick → the generic outcome-based effect (a CO signature can still override). */
type Choice = EffectId | "default";

export default function SettingsPage() {
  const { currentPlayer } = usePlayers();
  const utils = trpc.useUtils();
  const updatePreferences = trpc.user.updatePreferences.useMutation({
    onSuccess: () => void utils.user.me.invalidate(),
  });

  const savedPick = readParticleEffect(currentPlayer?.preferences);
  const [pick, setPick] = useState<Choice>(savedPick ?? "default");
  // Keep the highlight in sync once the refetched player lands.
  useEffect(() => setPick(savedPick ?? "default"), [savedPick]);

  const savedScope = readAnimationScope(currentPlayer?.preferences);
  const [scope, setScope] = useState<AnimationScope>(savedScope);
  useEffect(() => setScope(savedScope), [savedScope]);

  if (currentPlayer === undefined) {
    return (
      <main className="@mx-auto @max-w-3xl @px-6 @py-16 @text-slate-200">
        <h1 className="@mb-2 @text-2xl @font-bold">Settings</h1>
        <p className="@text-slate-400">Log in and select a player to change your settings.</p>
      </main>
    );
  }

  // The whole preferences object is rewritten on every save, so each patch must ride on top of the
  // current ones — otherwise picking a particle effect would silently clear the animation setting.
  const savePreferences = (patch: { particleEffect?: EffectId; animations?: AnimationScope }) => {
    updatePreferences.mutate({
      playerId: currentPlayer.id,
      ...(currentPlayer.preferences ?? {}),
      ...patch,
    });
  };

  const save = (choice: Choice) => {
    setPick(choice);
    savePreferences({ particleEffect: choice === "default" ? undefined : choice });
  };

  const saveScope = (choice: AnimationScope) => {
    setScope(choice);
    savePreferences({ animations: choice });
  };

  const scopeOptions: { id: AnimationScope; label: string; desc: string }[] = [
    { id: "all", label: "All armies", desc: "Play every flourish, yours and the enemy's." },
    { id: "own", label: "My units only", desc: "Skip the animations on the opponent's units." },
    { id: "none", label: "None", desc: "No flourishes. Badges and HP are still shown." },
  ];

  const effectPick: EffectId | undefined = pick === "default" ? undefined : pick;
  const previewTypes = resolveParticleTypes(undefined, "victory", effectPick);

  const options: { id: Choice; label: string; desc: string }[] = [
    {
      id: "default",
      label: "Default (by outcome)",
      desc: "Confetti & gold on a win, ash & embers on a loss.",
    },
    ...EFFECT_IDS.map((id) => ({
      id,
      label: PARTICLE_EFFECTS[id].label,
      desc: `Win: ${PARTICLE_EFFECTS[id].victory.join(" · ")}`,
    })),
  ];

  return (
    <>
      <Head>
        <title>Settings — Wars World</title>
      </Head>
      <main className="@mx-auto @max-w-4xl @px-6 @py-12 @text-slate-200">
        <h1 className="@mb-1 @text-2xl @font-bold">Settings</h1>
        <p className="@mb-8 @text-slate-400">
          Playing as <b>{currentPlayer.name}</b>
        </p>

        <section className="@mb-10">
          <h2 className="@mb-1 @text-lg @font-semibold">Battle animations</h2>
          <p className="@mb-4 @text-sm @text-slate-400">
            How much of the one-shot board animation to play — start-of-turn repairs and resupply,
            units going down to fuel-out. Turning them off never hides information: HP, capture
            progress and the low fuel / low ammo warnings stay on the board regardless.
          </p>

          <div className="@grid @grid-cols-1 @gap-3 sm:@grid-cols-3">
            {scopeOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => saveScope(option.id)}
                aria-pressed={scope === option.id}
                className={`@rounded-lg @border @p-3 @text-left @transition ${
                  scope === option.id
                    ? "@border-amber-400 @bg-amber-400/10"
                    : "@border-slate-700 @bg-slate-800/40 hover:@border-slate-500"
                }`}
              >
                <div className="@font-semibold">{option.label}</div>
                <div className="@mt-0.5 @text-xs @text-slate-400">{option.desc}</div>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2 className="@mb-1 @text-lg @font-semibold">End-of-match particles</h2>
          <p className="@mb-4 @text-sm @text-slate-400">
            The celebration effect on your victory / defeat screen. Some characters override this
            with their own signature effect. Preview any combination at{" "}
            <Link href="/gameover-preview" className="@text-amber-400 @underline">
              /gameover-preview
            </Link>
            .
          </p>

          <div className="@mb-6 @grid @grid-cols-1 @gap-3 sm:@grid-cols-2">
            {options.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => save(option.id)}
                aria-pressed={pick === option.id}
                className={`@rounded-lg @border @p-3 @text-left @transition ${
                  pick === option.id
                    ? "@border-amber-400 @bg-amber-400/10"
                    : "@border-slate-700 @bg-slate-800/40 hover:@border-slate-500"
                }`}
              >
                <div className="@font-semibold">{option.label}</div>
                <div className="@mt-0.5 @text-xs @text-slate-400">{option.desc}</div>
              </button>
            ))}
          </div>

          <div className="@mb-2 @flex @items-center @gap-3 @text-xs @text-slate-500">
            <span>Live preview (win)</span>
            {updatePreferences.isLoading && <span>saving…</span>}
            {updatePreferences.isSuccess && !updatePreferences.isLoading && <span>saved ✓</span>}
            {updatePreferences.isError && <span className="@text-red-400">couldn’t save</span>}
          </div>
          <div
            className="@relative @h-80 @w-full @overflow-hidden @rounded-lg @border @border-slate-700"
            style={{ background: "#000b2c" }}
          >
            <ParticleField key={pick} types={previewTypes} intensity={0.8} />
          </div>
        </section>
      </main>
    </>
  );
}
