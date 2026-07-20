/**
 * A commander's ID portrait. Uses the player's chosen image when one exists — a CO portrait picked
 * on the profile page, or an OAuth account image — otherwise renders a deterministic monogram: the
 * same name always yields the same initials and the same tint, so a player is visually recognizable
 * across the app without needing an uploaded avatar.
 *
 * A plain <img> (not next/image) is deliberate: CO art lives under /img and DB skins may be remote,
 * and these thumbnails are tiny — not worth wiring every possible host into next/image's allowlist.
 *
 * Tints are drawn from the Advance Wars country palette rather than a generic hue ramp — every badge
 * reads as an army insignia. `backgroundColor` is inline (not a Tailwind class) precisely because the
 * value is derived at runtime; a computed class name could not survive the JIT purge.
 */
const INSIGNIA_TINTS = [
  "#d04038", // orange star
  "#466efe", // blue moon
  "#37a42a", // green earth
  "#daa520", // yellow comet
  "#800080", // black hole
  "#E47220", // command orange
] as const;

function tintFor(name: string): string {
  let hash = 0;

  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }

  return INSIGNIA_TINTS[Math.abs(hash) % INSIGNIA_TINTS.length];
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "??";
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

type Props = {
  name: string;
  image?: string | null;
  /** Whether `image` is a pixel-art asset, so it scales crisply instead of blurring. */
  pixelated?: boolean;
  /** CSS object-position for the image (the player's chosen crop). Defaults to top-centre. */
  objectPosition?: string;
  size?: number;
  className?: string;
};

// A tactical badge silhouette — square with the bottom-right corner sliced off.
const BADGE_CLIP = "polygon(0 0, 100% 0, 100% 78%, 78% 100%, 0 100%)";

export default function UserAvatar({
  name,
  image,
  pixelated,
  objectPosition = "50% 0%",
  size = 40,
  className = "",
}: Props) {
  const tint = tintFor(name);

  return (
    <span
      className={`@relative @inline-flex @shrink-0 @items-center @justify-center @overflow-hidden @ring-1 @ring-white/20 ${className}`}
      style={{
        width: size,
        height: size,
        clipPath: BADGE_CLIP,
        backgroundColor: image ? "transparent" : tint,
      }}
    >
      {image ? (
        // Cropped to the player's chosen focal point (top-centre by default) so tall full-body CO
        // art shows the face, not the boots.
        <img
          src={image}
          alt={name}
          style={{ objectPosition }}
          className={`@absolute @inset-0 @h-full @w-full @object-cover ${
            pixelated ? "[image-rendering:pixelated]" : ""
          }`}
        />
      ) : (
        <>
          {/* diagonal sheen so the flat monogram reads as a stamped metal tag */}
          <span
            aria-hidden
            className="@absolute @inset-0 @bg-gradient-to-br @from-white/25 @via-transparent @to-black/30"
          />
          <span
            className="@relative @font-russoOne @font-bold @leading-none @text-white @drop-shadow-[0_1px_1px_rgba(0,0,0,0.5)]"
            style={{ fontSize: size * 0.4 }}
          >
            {initialsFor(name)}
          </span>
        </>
      )}
    </span>
  );
}
