"use client";
import { trpc } from "frontend/utils/trpc-client";
import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Data layer for the in-match chat, built on the shared social conversation system. On mount it
 * get-or-creates this match's two channels — **All** (whole match) and **Team** (the caller's team
 * only) — then loads history for the active channel and appends live `MESSAGE_NEW` events from the
 * social subscription. Team messages only reach teammates because the Team conversation's
 * participants are the team roster (the BE broadcasts to participants), so nothing leaks to enemies.
 *
 * `players` (id → name from `match.full`) resolves sender names for historical messages (the live
 * event already carries `senderName`).
 */
export type ChatChannel = "all" | "team";

export type ChatMessage = {
  id: string;
  senderId: string;
  senderName: string;
  content: string;
};

type Params = {
  matchId: string;
  playerId: string;
  players: { id: string; name: string }[];
  /** Whether the panel is open (drives unread accounting). */
  isOpen: boolean;
  activeChannel: ChatChannel;
};

const stripDev = (name: string): string => name.replace(/^\[dev\]\s*/, "");

export function useMatchChat({ matchId, playerId, players, isOpen, activeChannel }: Params) {
  const [channels, setChannels] = useState<{ all?: string; team?: string | null }>({});
  const [byConversation, setByConversation] = useState<Record<string, ChatMessage[]>>({});
  const [unread, setUnread] = useState<{ all: number; team: number }>({ all: 0, team: 0 });

  const nameById = useMemo(
    () => new Map(players.map((player) => [player.id, stripDev(player.name)])),
    [players],
  );
  const nameOf = (id: string): string => nameById.get(id) ?? id;

  // Latest channel/open/active in refs so the (once-established) subscription handler reads current
  // values instead of the closure it was created with.
  const channelsRef = useRef(channels);
  channelsRef.current = channels;
  const openRef = useRef(isOpen);
  openRef.current = isOpen;
  const activeRef = useRef(activeChannel);
  activeRef.current = activeChannel;

  // Get-or-create the match channels once.
  const ensureChannels = trpc.social.getOrCreateMatchChannels.useMutation();
  const ensureRef = useRef(ensureChannels.mutate);
  ensureRef.current = ensureChannels.mutate;

  useEffect(() => {
    ensureRef.current(
      { matchId, playerId },
      {
        onSuccess: (data) =>
          setChannels({ all: data.allConversationId, team: data.teamConversationId }),
      },
    );
  }, [matchId, playerId]);

  const activeConversationId =
    activeChannel === "all" ? channels.all : (channels.team ?? undefined);

  // History for the active channel (seeds the message list; live events append on top).
  const history = trpc.social.getConversationHistory.useQuery(
    { playerId, conversationId: activeConversationId ?? "" },
    { enabled: activeConversationId !== undefined },
  );

  useEffect(() => {
    if (history.data === undefined || activeConversationId === undefined) {
      return;
    }

    setByConversation((prev) => ({
      ...prev,
      [activeConversationId]: history.data.messages.map((message) => ({
        id: message.id,
        senderId: message.senderId,
        senderName: nameOf(message.senderId),
        content: message.content,
      })),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history.data, activeConversationId]);

  // Reset unread for the channel the player is currently looking at.
  useEffect(() => {
    if (isOpen) {
      setUnread((prev) => ({ ...prev, [activeChannel]: 0 }));
    }
  }, [isOpen, activeChannel, byConversation]);

  trpc.social.onSocialEvent.useSubscription(
    { playerId },
    {
      onData(event) {
        if (event.type !== "MESSAGE_NEW") {
          return;
        }

        const { all, team } = channelsRef.current;
        const channel: ChatChannel | null =
          event.conversationId === all ? "all" : event.conversationId === team ? "team" : null;

        if (channel === null) {
          return;
        }

        setByConversation((prev) => {
          const list = prev[event.conversationId] ?? [];

          if (list.some((message) => message.id === event.messageId)) {
            return prev;
          }

          return {
            ...prev,
            [event.conversationId]: [
              ...list,
              {
                id: event.messageId,
                senderId: event.senderId,
                senderName: stripDev(event.senderName),
                content: event.content,
              },
            ],
          };
        });

        // Not currently reading that channel → bump its unread badge.
        if (!openRef.current || activeRef.current !== channel) {
          setUnread((prev) => ({ ...prev, [channel]: prev[channel] + 1 }));
        }
      },
    },
  );

  const sendMessage = trpc.social.sendMessage.useMutation();

  const send = (content: string) => {
    const trimmed = content.trim();

    if (trimmed === "" || activeConversationId === undefined) {
      return;
    }

    sendMessage.mutate({ playerId, conversationId: activeConversationId, content: trimmed });
  };

  const messages =
    activeConversationId !== undefined ? (byConversation[activeConversationId] ?? []) : [];

  return {
    messages,
    send,
    sending: sendMessage.isLoading,
    unread,
    hasTeamChannel: channels.team != null,
    ready: activeConversationId !== undefined,
  };
}
