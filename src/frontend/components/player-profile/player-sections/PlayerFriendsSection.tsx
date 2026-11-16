import { trpc } from "frontend/utils/trpc-client";
import { PlayerFriendLink } from "../PlayerFriendLink";

/**
 * The friends panel, on real `players.friends` data — the profile owner's accepted friends, each a
 * portrait + handle linking to their profile.
 */
export function PlayerFriendSection({ name }: { name: string }) {
  const { data: friends, isLoading } = trpc.players.friends.useQuery(
    { name },
    { enabled: name !== "" },
  );

  return (
    <section className="@my-4 @overflow-hidden @border @border-primary/25 @bg-black/60 [clip-path:polygon(0_0,100%_0,100%_100%,3%_100%,0_94%)]">
      <div className="@flex @items-center @gap-2 @border-b @border-primary/20 @bg-gradient-to-r @from-bg-secondary/60 @to-transparent @px-4 @py-2.5">
        <span className="@h-3 @w-1 @bg-primary" />
        <h3 className="@font-russoOne @text-sm @uppercase @tracking-wider @text-white">Friends</h3>
        {friends && friends.length > 0 && (
          <span className="@ml-auto @font-russoOne @text-sm @text-primary-light">
            {friends.length}
          </span>
        )}
      </div>

      <div className="@p-2">
        {isLoading && <p className="@px-2 @py-3 @text-sm @text-white/40">Loading…</p>}
        {friends && friends.length === 0 && (
          <p className="@px-2 @py-3 @text-sm @text-white/40">No friends yet.</p>
        )}
        {friends && friends.length > 0 && (
          <div className="@flex @flex-col @gap-0.5">
            {friends.map((friend) => (
              <PlayerFriendLink
                key={friend.name}
                name={friend.name}
                avatar={friend.avatar}
                favouriteCO={friend.favouriteCO}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
