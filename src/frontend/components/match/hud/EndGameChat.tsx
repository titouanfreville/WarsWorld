"use client";

import { ChatComposer } from "frontend/components/chat/ChatComposer";
import { ChatShell } from "frontend/components/chat/ChatShell";
import { useChatAutoscroll } from "frontend/components/chat/useChatAutoscroll";
import { useMatchChat } from "frontend/components/match/useMatchChat";
import { PlayerMention } from "frontend/components/PlayerMention";
import { trpc } from "frontend/utils/trpc-client";
import { useEffect, useRef, useState } from "react";

/**
 * Post-game chat on the End-Game screen (Epic 5, §mockup step 7 / FR7). Renders the shared docked
 * `ChatShell` so it matches every other chat surface, and reuses the match's conversation plumbing
 * (`useMatchChat`, All channel) for history + live messages + send. A presence heartbeat keeps the
 * write window open while participants linger: when the viewer is a participant it beats
 * `endgame.chatHeartbeat` every few seconds; the server keeps the conversation writable while anyone
 * is present and drains it to read-only once everyone leaves.
 *
 * `readOnly` renders a transcript with no composer — for the future historical view (FR8), where the
 * live channels/presence no longer apply.
 */

// Comfortably inside the server's presence TTL so a single dropped beat never closes the window.
const HEARTBEAT_MS = 7_000;

export function EndGameChat({
  matchId,
  viewerId,
  players,
  readOnly = false,
}: {
  matchId: string;
  viewerId: string | undefined;
  players: { id: string; name: string }[];
  readOnly?: boolean;
}) {
  const isParticipant = viewerId !== undefined && !readOnly;

  const { messages, send, sending, ready, avatarForHandle } = useMatchChat({
    matchId,
    playerId: viewerId ?? "",
    players,
    isOpen: true,
    activeChannel: "all",
  });

  const heartbeat = trpc.endgame.chatHeartbeat.useMutation();
  const [writable, setWritable] = useState(true);

  const listRef = useChatAutoscroll<HTMLDivElement>([messages]);

  // Presence heartbeat: mark the viewer present now and on an interval while this panel is mounted.
  // Latest mutate in a ref so the interval effect runs once (not re-created every render).
  const beatRef = useRef(heartbeat.mutate);
  beatRef.current = heartbeat.mutate;

  useEffect(() => {
    if (!isParticipant || viewerId === undefined) {
      return;
    }

    const beat = () =>
      beatRef.current(
        { playerId: viewerId, matchId },
        { onSuccess: (data) => setWritable(data.writable) },
      );

    beat();
    const timer = setInterval(beat, HEARTBEAT_MS);

    return () => clearInterval(timer);
  }, [isParticipant, viewerId, matchId]);

  const canSend = isParticipant && writable && ready;
  const nameById = new Map(players.map((player) => [player.id, player.name]));

  // The closed/read-only states replace the composer with an explanatory line.
  const notice = readOnly
    ? "This match is archived — chat is read-only."
    : !isParticipant
      ? "Only participants can chat."
      : !writable
        ? "Post-game chat has closed — everyone left."
        : null;

  return (
    <ChatShell
      variant="docked"
      title="Post-game"
      live={canSend}
      actions={
        <span className="@rounded-full @border @border-white/15 @px-2 @py-0.5 @text-[10px] @uppercase @tracking-wide @text-slate-400">
          {readOnly ? "Transcript" : canSend ? "Open" : "Closed"}
        </span>
      }
      bodyRef={listRef}
      footer={
        notice !== null ? (
          <p className="@px-1 @py-0.5 @text-xs @italic @text-slate-500">{notice}</p>
        ) : (
          <ChatComposer onSend={send} sending={sending} disabled={!canSend} />
        )
      }
    >
      <div className="@flex @flex-col @gap-1.5 @text-sm">
        {messages.length === 0 ? (
          <p className="@my-auto @text-xs @italic @text-slate-500">
            {readOnly ? "No messages were sent." : "Say gg — messages appear here."}
          </p>
        ) : (
          messages.map((message) => (
            <div key={message.id} className="@flex @items-center @gap-1.5 @py-0 @leading-snug">
              <PlayerMention
                name={message.senderHandle}
                label={nameById.get(message.senderId) ?? message.senderName}
                avatar={avatarForHandle(message.senderHandle)}
                className={`@shrink-0 @font-semibold ${
                  message.senderId === viewerId ? "@text-primary" : "@text-slate-300"
                }`}
              />
              <span className="@min-w-0 @text-slate-100">{message.content}</span>
            </div>
          ))
        )}
      </div>
    </ChatShell>
  );
}
