/**
 * Small diagrams for the two controls whose meaning is spatial.
 *
 * A mirror mode and a brush tool are both easier to recognise as a picture than to read as a word:
 * "mirrored on both axes" takes a sentence to explain and one glance to see. Each mirror glyph
 * shows where a single stroke lands — one filled quadrant for the stroke, fainter ones for its
 * images — so the control looks like what it does.
 */

type GlyphProps = { className?: string };

const box = (
  <rect
    x="0.5"
    y="0.5"
    width="23"
    height="23"
    fill="none"
    stroke="currentColor"
    strokeOpacity="0.25"
  />
);

const quad = (x: number, y: number, opacity: number) => (
  <rect x={x} y={y} width="9" height="9" fill="currentColor" fillOpacity={opacity} />
);

const Svg = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={className ?? "@h-5 @w-5"}>
    {box}
    {children}
  </svg>
);

/** One stroke, one tile. */
export const MirrorOffGlyph = ({ className }: GlyphProps) => (
  <Svg className={className}>{quad(2, 2, 1)}</Svg>
);

/** The stroke and its opposite corner. */
export const MirrorRotate180Glyph = ({ className }: GlyphProps) => (
  <Svg className={className}>
    {quad(2, 2, 1)}
    {quad(13, 13, 0.45)}
  </Svg>
);

/** All four quadrants, reflected rather than turned. */
export const MirrorBothGlyph = ({ className }: GlyphProps) => (
  <Svg className={className}>
    {quad(2, 2, 1)}
    {quad(13, 2, 0.45)}
    {quad(2, 13, 0.45)}
    {quad(13, 13, 0.45)}
  </Svg>
);

/** All four quadrants, each a quarter-turn on from the last. */
export const MirrorRotate90Glyph = ({ className }: GlyphProps) => (
  <Svg className={className}>
    {quad(2, 2, 1)}
    {quad(13, 2, 0.45)}
    {quad(13, 13, 0.45)}
    {quad(2, 13, 0.45)}
    <path
      d="M9 5 A7 7 0 0 1 19 9"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </Svg>
);

export const MIRROR_GLYPHS: Record<string, (props: GlyphProps) => JSX.Element> = {
  none: MirrorOffGlyph,
  rotate180: MirrorRotate180Glyph,
  mirrorBoth: MirrorBothGlyph,
  rotate90: MirrorRotate90Glyph,
};

/** A single tile under a nib: paint one square. */
export const BrushGlyph = ({ className }: GlyphProps) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={className ?? "@h-4 @w-4"}>
    <path
      d="M5 19c0-3 2-4 3.5-4S11 16 11 17.5 9.5 20 8 20H5v-1Z"
      fill="currentColor"
      fillOpacity="0.9"
    />
    <path d="M10 15 19 5l1.5 1.5L11 16Z" fill="currentColor" fillOpacity="0.55" />
  </svg>
);

/** A poured region: everything connected takes the colour. */
export const FillGlyph = ({ className }: GlyphProps) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={className ?? "@h-4 @w-4"}>
    <path d="M4 12 11 5l8 8-7 7-8-8Z" fill="currentColor" fillOpacity="0.55" />
    <circle cx="19.5" cy="16.5" r="2.5" fill="currentColor" fillOpacity="0.9" />
  </svg>
);

/** An eyedropper: take what is already there. */
export const PickGlyph = ({ className }: GlyphProps) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={className ?? "@h-4 @w-4"}>
    <path
      d="M14 4.5 19.5 10 11 18.5H5.5V13L14 4.5Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
    <path d="M12.5 6 18 11.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

export const TOOL_GLYPHS: Record<string, (props: GlyphProps) => JSX.Element> = {
  brush: BrushGlyph,
  fill: FillGlyph,
  pick: PickGlyph,
};
