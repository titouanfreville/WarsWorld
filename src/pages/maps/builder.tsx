import type {
  ArmySpritesheetData,
  SpritesheetDataByArmy,
} from "frontend/components/match/getSpritesheetData";
import { usePlayers } from "frontend/context/players";
import type { GetServerSideProps } from "next";
import dynamic from "next/dynamic";
import Head from "next/head";
import Link from "next/link";
import fs from "node:fs/promises";
import path from "node:path";
import { spritesheetDataSchema } from "server/core/schemas/spritesheet-data";

/**
 * The map builder.
 *
 * Client-only: it drives a pixi canvas, which cannot be server-rendered. The spritesheet JSON is
 * read at request time and handed down as props, exactly as the match page does — the atlases are
 * the same ones the board draws with, so a map looks identical here and in play.
 */
const MapBuilderNoSSR = dynamic(() => import("components/client-only/MapBuilder"), {
  ssr: false,
  loading: () => <p className="@p-6 @text-white/50">Loading builder…</p>,
});

type Props = { spritesheetDataByArmy: SpritesheetDataByArmy };

export default function MapBuilderPage({ spritesheetDataByArmy }: Props) {
  const { currentPlayer } = usePlayers();

  return (
    <>
      <Head>
        <title>Build a map | Wars World</title>
      </Head>

      {currentPlayer === undefined ? (
        // Authoring is tied to a player, not just an account: a map's byline is a player profile.
        <div className="@flex @flex-col @items-center @gap-3 @p-10 @text-center">
          <p className="@text-white/60">You need to be signed in with a player to build a map.</p>
          <Link href="/" className="@text-primary hover:@underline">
            Back to the front page
          </Link>
        </div>
      ) : (
        <MapBuilderNoSSR
          playerId={currentPlayer.id}
          spritesheetDataByArmy={spritesheetDataByArmy}
        />
      )}
    </>
  );
}

export const getServerSideProps: GetServerSideProps<Props> = async () => {
  const sheets = await Promise.all(
    ["yellow-comet", "green-earth", "black-hole", "orange-star", "blue-moon", "neutral"].map(
      async (sheetName) => {
        const filePath = path.join(process.cwd(), `public/img/spriteSheet/${sheetName}.json`);
        const fileData = await fs.readFile(filePath, "utf-8");

        return {
          sheetName,
          data: spritesheetDataSchema.parse(JSON.parse(fileData)) as ArmySpritesheetData,
        };
      },
    ),
  );

  return {
    props: {
      spritesheetDataByArmy: sheets.reduce<Partial<SpritesheetDataByArmy>>(
        (all, sheet) => ({ ...all, [sheet.sheetName]: sheet.data }),
        {},
      ) as SpritesheetDataByArmy,
    },
  };
};
