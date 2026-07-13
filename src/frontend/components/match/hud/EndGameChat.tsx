"use client";

import { useMatchChat } from "frontend/components/match/useMatchChat";
import { trpc } from "frontend/utils/trpc-client";
import { useEffect, useRef, useState } from "react";

/**
 * Post-game chat on the End-Game screen (Epic 5, §mockup step 7 / FR7). Reuses the match's shared
 * conversation plumbing (`useMatchChat`, All channel) for history + live messages + send, and adds a
 * presence heartbeat so the write window stays open while participants linger. When the viewer is a
 * participant it beats `endgame.chatHeartbeat` every few seconds; the server keeps the conversation
 * writable while anyone is present and drains it to read-only once everyone leaves.
 *
 * `readOnly` renders a transcript with no input — for the future historical view (FR8), where the
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

  const { messages, send, sending, ready } = useMatchChat({
    matchId,
    playerId: viewerId ?? "",
    players,
    isOpen: true,
    activeChannel: "all",
  });

  const heartbeat = trpc.endgame.chatHeartbeat.useMutation();
  const [writable, setWritable] = useState(true);
  const [draft, setDraft] = useState("");

  const listRef = useRef<HTMLDivElement | null>(null);

  // Keep the transcript pinned to the latest message.
  useEffect(() => {
    const el = listRef.current;

    if (el !== null) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

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

  const submit = () => {
    const trimmed = draft.trim();

    if (trimmed === "" || !canSend) {
      return;
    }

    send(trimmed);
    setDraft("");
  };

  const nameById = new Map(players.map((player) => [player.id, player.name]));

  return (
    <section className="egs__panel egs-chat">
      <header className="egs__panel-head">
        <h2 className="egs__panel-title">Post-game chat</h2>
        {readOnly ? (
          <span className="egs__soon">Transcript</span>
        ) : (
          canSend && <span className="egs-chat__live">Open</span>
        )}
      </header>

      <div ref={listRef} className="egs-chat__log">
        {messages.length === 0 ? (
          <p className="egs-chat__empty">
            {readOnly ? "No messages were sent." : "Say gg — messages appear here."}
          </p>
        ) : (
          messages.map((message) => (
            <p className="egs-chat__msg" key={message.id}>
              <span className={`egs-chat__sender${message.senderId === viewerId ? " is-you" : ""}`}>
                {nameById.get(message.senderId) ?? message.senderName}
              </span>
              <span className="egs-chat__text">{message.content}</span>
            </p>
          ))
        )}
      </div>

      {readOnly ? (
        <p className="egs-chat__closed">This match is archived — chat is read-only.</p>
      ) : !isParticipant ? (
        <p className="egs-chat__closed">Only participants can chat.</p>
      ) : writable ? (
        <div className="egs-chat__compose">
          <input
            className="egs-chat__input"
            value={draft}
            maxLength={500}
            placeholder="Message everyone…"
            disabled={!ready}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <button
            type="button"
            className="egs-chat__send"
            disabled={draft.trim() === "" || sending || !canSend}
            onClick={submit}
          >
            Send
          </button>
        </div>
      ) : (
        <p className="egs-chat__closed">Post-game chat has closed — everyone left.</p>
      )}
    </section>
  );
}
