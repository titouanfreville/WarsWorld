// Deliberate exception to "core is framework-free": these are TYPE-ONLY imports (erased at build,
// zero runtime coupling). Sprite-sheet data IS the pixi wire format, so the `satisfies` clauses
// below are a compile-time guarantee that our schema matches what pixi consumes — a real contract
// check we'd lose by inlining local copies. Keep as type-only; never import pixi values here.
import type { ISpritesheetData, ISpritesheetFrameData } from "pixi.js";
import { z } from "zod";

const sizeSchema = z.strictObject({
  w: z.number(),
  h: z.number(),
}) satisfies z.ZodType<ISpritesheetFrameData["sourceSize"]>;

const sizeAndPositionSchema = sizeSchema.extend({
  x: z.number(),
  y: z.number(),
}) satisfies z.ZodType<ISpritesheetFrameData["frame"]>;

const frameSchema = z.strictObject({
  frame: sizeAndPositionSchema,
  rotated: z.boolean(),
  trimmed: z.boolean(),
  spriteSourceSize: sizeAndPositionSchema,
  sourceSize: sizeSchema,
}) satisfies z.ZodType<ISpritesheetFrameData>;

export const spritesheetDataSchema = z.strictObject({
  frames: z.record(frameSchema),
  animations: z.record(z.array(z.string())).optional(),
  meta: z.object({
    scale: z.string().or(z.number()),
    image: z.string(),
    // The full atlas dimensions. Preserved deliberately: `z.object` strips keys it doesn't name,
    // and dropping `size` here left every DOM sprite (terrain thumbs, the dev unit picker) unable
    // to scale/crop the atlas — `terrainThumb`/`unitThumb` returned undefined and fell back to text.
    size: sizeSchema.optional(),
  }),
}) satisfies z.ZodType<ISpritesheetData>;
