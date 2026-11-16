// Identity + stats slices are live (real avatar / name / ranks / CO usage via the players feature).
// The friends panel below still renders mock data — that's the next slice.

import EditProfileModal from "frontend/components/player-profile/EditProfileModal";
import { PlayerFriendSection } from "frontend/components/player-profile/player-sections/PlayerFriendsSection";
import { ProfileHeader } from "frontend/components/player-profile/ProfileHeader";
import { ProfileStats } from "frontend/components/player-profile/ProfileStats";
import { usePlayers } from "frontend/context/players";
import { trpc } from "frontend/utils/trpc-client";
import Head from "next/head";
import { useRouter } from "next/router";
import { useState } from "react";
import { z } from "zod";

export default function UserProfile() {
  const { query } = useRouter();
  const { currentPlayer } = usePlayers();
  const [editing, setEditing] = useState(false);

  const playerNameParse = z.string().safeParse(query?.playerName);
  const playerName = playerNameParse.success ? playerNameParse.data : "";
  const enabled = playerName !== "";

  const profile = trpc.players.profile.useQuery({ name: playerName }, { enabled });
  const stats = trpc.players.stats.useQuery({ name: playerName }, { enabled });

  if (!playerNameParse.success) {
    return <p className="@p-8 @text-center @text-white">Error!</p>;
  }

  const isOwnProfile = currentPlayer?.name === playerName;

  return (
    <>
      <Head>
        <title>{playerName} | Wars World</title>
      </Head>

      <div className="@flex @flex-col @items-center @justify-center @align-middle">
        <div className="@m-4 @w-[95%] tablet:@w-[80%] smallscreen:@px-4">
          {profile.isLoading && (
            <p className="@mt-8 @text-center @text-white/60">Loading dossier…</p>
          )}
          {profile.isError && (
            <p className="@mt-8 @text-center @text-orange-star">No commander “{playerName}”.</p>
          )}

          {profile.data && (
            <>
              <ProfileHeader
                name={profile.data.name}
                realName={profile.data.realName}
                avatar={profile.data.avatar}
                favouriteCO={profile.data.favouriteCO}
                isOwnProfile={isOwnProfile}
                onEdit={() => setEditing(true)}
              />

              <div className="@flex @flex-col laptop:@flex-row laptop:@space-x-4">
                <div className="@h-full laptop:@w-[75%]">
                  {stats.data ? (
                    <ProfileStats
                      ranks={stats.data.ranks}
                      coPlayed={stats.data.coPlayed}
                      coWinRate={stats.data.coWinRate}
                      maps={stats.data.maps}
                      units={stats.data.units}
                      combat={stats.data.combat}
                      totals={stats.data.totals}
                    />
                  ) : (
                    <p className="@mt-8 @text-center @text-white/40">Loading stats…</p>
                  )}
                </div>
                <div className="@min-h-full @mb-8 laptop:@w-[25%]">
                  <PlayerFriendSection name={profile.data.name} />
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {editing && isOwnProfile && <EditProfileModal onClose={() => setEditing(false)} />}
    </>
  );
}
