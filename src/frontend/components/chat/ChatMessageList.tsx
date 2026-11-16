"use client";
import UserAvatar from "frontend/components/navbar/UserAvatar";
import { avatarImageProps, type CoAvatar } from "frontend/utils/sprites/avatar";
import { formatClockTime } from "frontend/utils/format-time";
import type { ReactNode } from "react";

/**
 * The shared DM message thread — bubbles aligned by author, the partner's avatar beside their lines,
 * a timestamp, and optional per-message slots. Every out-of-game chat surface (the global feed, the
 * social hub, and future ones) renders through this so a new message feature is added once, here.
 *
 * The extras that differ per surface (edit-in-place, hover actions, read receipts) come in as render
 * props rather than being baked in — the hub passes them, the lightweight feed omits them.
 */
export type ChatBubbleMessage = {
  id: string;
  senderId: string;
  content: string;
  createdAt: Date | string;
};

type Props<Message extends ChatBubbleMessage> = {
  messages: Message[];
  currentPlayerId: string;
  /** The DM partner's chosen avatar, shown beside their bubbles. */
  partnerAvatar?: CoAvatar | null;
  /** Name for the partner avatar's monogram fallback. */
  partnerName?: string;
  emptyLabel?: string;
  /** Return an editor to replace the bubble (edit-in-place); return null for the normal bubble. */
  renderEditing?: (message: Message, isMe: boolean) => ReactNode | null;
  /** Hover controls overlaid on a bubble (e.g. edit / delete on your own messages). */
  renderActions?: (message: Message, isMe: boolean) => ReactNode;
  /** Extra meta beside the timestamp (e.g. "(edited)", "✓✓ Viewed"). */
  renderMeta?: (message: Message, isMe: boolean) => ReactNode;
};

export function ChatMessageList<Message extends ChatBubbleMessage>({
  messages,
  currentPlayerId,
  partnerAvatar,
  partnerName = "?",
  emptyLabel = "No messages yet.",
  renderEditing,
  renderActions,
  renderMeta,
}: Props<Message>) {
  if (messages.length === 0) {
    return (
      <div className="@flex @h-full @items-center @justify-center @text-center @text-xs @text-slate-500">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="@flex @flex-col @gap-3">
      {messages.map((message) => {
        const isMe = message.senderId === currentPlayerId;
        const editor = renderEditing?.(message, isMe) ?? null;

        return (
          <div
            key={message.id}
            className={`@flex @max-w-[80%] @gap-2.5 ${isMe ? "@ml-auto @justify-end" : ""}`}
          >
            {!isMe && (
              <UserAvatar
                name={partnerName}
                size={28}
                className="@mt-0.5 @shrink-0"
                {...avatarImageProps(partnerAvatar)}
              />
            )}

            <div className="@flex @min-w-0 @flex-col @gap-1">
              {editor ?? (
                <div className="@group @relative">
                  <div
                    className={`@rounded-xl @px-3 @py-1.5 @text-xs @leading-relaxed ${
                      isMe
                        ? "@rounded-tr-none @bg-primary @font-semibold @text-black"
                        : "@rounded-tl-none @border @border-bg-tertiary/40 @bg-bg-secondary @text-slate-100"
                    }`}
                  >
                    {message.content}
                  </div>
                  {renderActions?.(message, isMe)}
                </div>
              )}

              <div
                className={`@flex @items-center @gap-1.5 @text-[9px] @text-slate-500 ${
                  isMe ? "@justify-end" : ""
                }`}
              >
                <span>{formatClockTime(message.createdAt)}</span>
                {renderMeta?.(message, isMe)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
