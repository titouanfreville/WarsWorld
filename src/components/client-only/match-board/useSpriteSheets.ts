import { useQuery } from "@tanstack/react-query";
import type { SpritesheetDataByArmy } from "frontend/components/match/getSpritesheetData";
import { loadSpritesFromSpriteMap } from "pixi/load-spritesheet";
import { Assets } from "pixi.js";

/**
 * Loads the board's drawing assets once per session: the bitmap font the in-board pixi menus render
 * with ("awFont", declared in `aw2Font.fnt`) and every army's spritesheet. Cached under a static
 * react-query key — the underlying sheet DATA is server-rendered into the page, so this is decode
 * work, not a network round-trip per match.
 */
export function useSpriteSheets(spritesheetDataByArmy: SpritesheetDataByArmy) {
  return useQuery({
    queryKey: ["spritesheets"],
    queryFn: async () => {
      await Assets.load("/aw2Font.fnt");

      return loadSpritesFromSpriteMap(spritesheetDataByArmy);
    },
  });
}
