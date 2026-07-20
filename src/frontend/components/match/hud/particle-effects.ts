/**
 * Particle-effect vocabulary for the end-of-match screen. Pure FE presentation (see ParticleField
 * for rendering): a small library of named effects, a per-CO "signature" derived from each general's
 * pose art, and the resolver that picks which effect plays for a given viewer.
 *
 * Resolution priority (locked): CO signature → the player's own picked effect → the generic default.
 * So a character with a bespoke signature always shows it; everyone else gets the player's chosen
 * effect, falling back to festive confetti / ash.
 */

/** The atomic particle kinds ParticleField knows how to draw. */
export type ParticleType = "confetti" | "goldBurst" | "petal" | "ash" | "ember" | "droplet";

/** A named, self-coherent effect: which particles play on each outcome. */
export type EffectId = "festive" | "golden" | "petals" | "inferno" | "storm";

type Outcome = "victory" | "defeat" | "draw";
type Effect = {
  label: string;
  victory: ParticleType[];
  defeat: ParticleType[];
  draw: ParticleType[];
};

export const PARTICLE_EFFECTS: Record<EffectId, Effect> = {
  festive: {
    label: "Festive — confetti & gold",
    victory: ["confetti", "goldBurst", "petal"],
    defeat: ["ash", "ember", "droplet"],
    draw: ["ash", "confetti"],
  },
  golden: {
    label: "Golden — gilded burst",
    victory: ["goldBurst", "confetti"],
    defeat: ["ash", "ember"],
    draw: ["goldBurst"],
  },
  petals: {
    label: "Petals — falling blossom",
    victory: ["petal", "goldBurst"],
    defeat: ["petal", "ash"],
    draw: ["petal"],
  },
  inferno: {
    label: "Inferno — embers & sparks",
    victory: ["ember", "goldBurst"],
    defeat: ["ember", "ash", "droplet"],
    draw: ["ember"],
  },
  storm: {
    label: "Storm — ash & rain",
    victory: ["confetti", "ash"],
    defeat: ["ash", "droplet"],
    draw: ["ash"],
  },
};

/** All effect ids a player may pick, in menu order. */
export const EFFECT_IDS = Object.keys(PARTICLE_EFFECTS) as EffectId[];

/** The absolute fallback when a CO has no signature and the player hasn't picked. */
export const DEFAULT_EFFECT: EffectId = "festive";

/**
 * Signature effect for specific COs, derived from their pose art (celebratory particles baked into
 * the source illustration). Only listed COs override the player's pick; extend as art dictates.
 */
export const CO_SIGNATURE: Partial<Record<string, EffectId>> = {
  drake: "festive", // confetti burst in his victory card
  hachi: "golden", // treasure / gold-coin motif
  flak: "inferno", // brawler amid wreckage
  kindle: "petals", // elegant, floral
  sturm: "storm", // dark meteor-storm theme
};

/** Extract a player's picked effect from their (loosely-typed) stored preferences JSON. */
export const readParticleEffect = (preferences: unknown): EffectId | undefined =>
  (preferences as { particleEffect?: EffectId } | null | undefined)?.particleEffect;

/** The effect that plays for a viewer, applying the locked priority order. */
export const resolveEffectId = (
  coName: string | undefined,
  userPick: EffectId | undefined,
): EffectId =>
  (coName !== undefined ? CO_SIGNATURE[coName] : undefined) ?? userPick ?? DEFAULT_EFFECT;

/** The particle types to render for a viewer's CO + outcome, after resolution. */
export const resolveParticleTypes = (
  coName: string | undefined,
  outcome: Outcome,
  userPick: EffectId | undefined,
): ParticleType[] => {
  const effect = PARTICLE_EFFECTS[resolveEffectId(coName, userPick)];

  return outcome === "victory"
    ? effect.victory
    : outcome === "defeat"
      ? effect.defeat
      : effect.draw;
};
