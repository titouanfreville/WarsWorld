import {
  avatarObjectPosition,
  coAvatarUrl,
  isPixelVariant,
  type AvatarPose,
  type AvatarVariant,
  type CoAvatar,
} from "frontend/utils/sprites/avatar";
import { CO_NAMES, coPortraitUrl, type CoName } from "frontend/utils/sprites/co";
import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

/**
 * The CO-portrait avatar builder: a live dossier preview plus three axes — which general, which pose,
 * and which art set. Controlled: it owns no avatar state, it emits changes to the parent (the Edit
 * Profile modal) which persists them.
 */

type Props = {
  value: CoAvatar;
  onChange: (next: CoAvatar) => void;
};

const POSES: { id: AvatarPose; label: string }[] = [
  { id: "neutral", label: "Neutral" },
  { id: "win", label: "Victory" },
  { id: "lose", label: "Defeat" },
];

const VARIANTS: { id: AvatarVariant; label: string }[] = [
  { id: "art", label: "Full Art" },
  { id: "portraitFull", label: "Mug L" },
  { id: "portraitSmall", label: "Mug S" },
];

const prettyCo = (co: string): string =>
  co
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

export default function AvatarBuilder({ value, onChange }: Props) {
  const [query, setQuery] = useState("");
  // Live drag state for repositioning the crop: where the pointer grabbed, and the focal point then.
  const drag = useRef<{ startX: number; startY: number; from: { x: number; y: number } } | null>(
    null,
  );

  const roster = useMemo<readonly CoName[]>(() => {
    const needle = query.trim().toLowerCase();
    return needle === "" ? CO_NAMES : CO_NAMES.filter((co) => co.includes(needle));
  }, [query]);

  const previewUrl = coAvatarUrl(value);
  const pixelated = isPixelVariant(value.variant);
  // Only the tall full-body art overflows the square frame, so that's the only variant worth panning.
  const canReposition = value.variant === "art";
  const position = value.position ?? { x: 50, y: 0 };

  // Drag maps a full frame-width/height of travel to the full 0..100 range — dragging the picture up
  // reveals what's lower, down reveals what's higher (the natural "grab and move the image" gesture).
  const FRAME_PX = 176; // matches @h-44 / @w-44

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!canReposition) {
      return;
    }

    drag.current = { startX: event.clientX, startY: event.clientY, from: position };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current === null) {
      return;
    }

    const clamp = (n: number) => Math.max(0, Math.min(100, n));
    const dx = ((event.clientX - drag.current.startX) / FRAME_PX) * 100;
    const dy = ((event.clientY - drag.current.startY) / FRAME_PX) * 100;
    onChange({
      ...value,
      position: { x: clamp(drag.current.from.x - dx), y: clamp(drag.current.from.y - dy) },
    });
  };

  const endDrag = () => {
    drag.current = null;
  };

  return (
    <div className="@flex @flex-col @gap-5 tablet:@flex-row">
      {/* ── Live dossier preview ─────────────────────────────────────────── */}
      <div className="@flex @shrink-0 @flex-col @items-center @gap-2">
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className={`@relative @h-44 @w-44 @touch-none @select-none @overflow-hidden @border-2 @border-primary/60 @bg-gradient-to-b @from-bg-secondary @to-bg-primary
            [clip-path:polygon(0_0,100%_0,100%_88%,88%_100%,0_100%)] ${
              canReposition ? "@cursor-grab active:@cursor-grabbing" : ""
            }`}
        >
          {/* faint grid so an empty/transparent portrait still reads as a framed slot */}
          <div
            aria-hidden
            className="@absolute @inset-0 @opacity-20"
            style={{
              backgroundImage:
                "linear-gradient(#ffffff22 1px, transparent 1px), linear-gradient(90deg, #ffffff22 1px, transparent 1px)",
              backgroundSize: "16px 16px",
            }}
          />
          <img
            src={previewUrl}
            alt={prettyCo(value.co)}
            draggable={false}
            style={{ objectPosition: avatarObjectPosition(value) }}
            className={`@absolute @inset-0 @h-full @w-full @object-cover ${
              pixelated ? "[image-rendering:pixelated]" : ""
            }`}
          />
          {canReposition && (
            <span className="@pointer-events-none @absolute @left-0 @right-0 @top-0 @bg-black/60 @px-2 @py-1 @text-center @text-[9px] @uppercase @tracking-widest @text-white/70">
              Drag to reposition
            </span>
          )}
          <span className="@pointer-events-none @absolute @bottom-0 @left-0 @right-0 @bg-black/70 @px-2 @py-1 @text-center @font-russoOne @text-xs @uppercase @tracking-widest @text-primary-light">
            {prettyCo(value.co)}
          </span>
        </div>
        <p className="@text-[10px] @uppercase @tracking-[0.25em] @text-white/40">Preview</p>
      </div>

      {/* ── Controls ─────────────────────────────────────────────────────── */}
      <div className="@flex @min-w-0 @flex-1 @flex-col @gap-4">
        <Segmented
          label="Pose"
          options={POSES}
          selected={value.pose}
          onSelect={(pose) => onChange({ ...value, pose })}
        />
        <Segmented
          label="Art set"
          options={VARIANTS}
          selected={value.variant}
          onSelect={(variant) => onChange({ ...value, variant })}
        />

        <div>
          <div className="@mb-1.5 @flex @items-center @justify-between">
            <span className="@text-[10px] @font-bold @uppercase @tracking-[0.25em] @text-primary/80">
              Commander
            </span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="search…"
              className="@w-28 @rounded @border @border-white/15 @bg-black/40 @px-2 @py-0.5 @text-xs @text-white @outline-none focus:@border-primary/60"
            />
          </div>
          <div className="@grid @max-h-40 @grid-cols-5 @gap-1.5 @overflow-y-auto @pr-1 smallscreen:@grid-cols-7">
            {roster.map((co) => {
              const active = co === value.co;
              return (
                <button
                  key={co}
                  type="button"
                  title={prettyCo(co)}
                  aria-pressed={active}
                  onClick={() => onChange({ ...value, co })}
                  className={`@relative @aspect-square @overflow-hidden @border @transition-all ${
                    active
                      ? "@border-primary @ring-1 @ring-primary @scale-105"
                      : "@border-white/10 hover:@border-primary/50"
                  }`}
                >
                  <img
                    src={coPortraitUrl(co, "small")}
                    alt={prettyCo(co)}
                    className="@h-full @w-full @object-cover [image-rendering:pixelated]"
                  />
                </button>
              );
            })}
            {roster.length === 0 && (
              <p className="@col-span-full @py-3 @text-center @text-xs @text-white/40">
                No commander matches “{query}”.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

type SegmentedProps<T extends string> = {
  label: string;
  options: { id: T; label: string }[];
  selected: T;
  onSelect: (id: T) => void;
};

function Segmented<T extends string>({ label, options, selected, onSelect }: SegmentedProps<T>) {
  return (
    <div>
      <span className="@mb-1.5 @block @text-[10px] @font-bold @uppercase @tracking-[0.25em] @text-primary/80">
        {label}
      </span>
      <div className="@flex @gap-1">
        {options.map((option) => {
          const active = option.id === selected;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={active}
              onClick={() => onSelect(option.id)}
              className={`@flex-1 @border @px-2 @py-1.5 @text-xs @font-semibold @uppercase @tracking-wide @transition-colors ${
                active
                  ? "@border-primary @bg-primary/20 @text-white"
                  : "@border-white/10 @bg-black/30 @text-white/60 hover:@border-primary/40 hover:@text-white"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
