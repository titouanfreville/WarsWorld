export type SocialEvent =
  | {
      type: "MESSAGE_NEW";
      conversationId: string;
      senderId: string;
      senderName: string;
      content: string;
      createdAt: Date;
      messageId: string;
    }
  | {
      type: "MESSAGE_EDIT";
      conversationId: string;
      messageId: string;
      content: string;
      editedAt: Date;
    }
  | { type: "MESSAGE_DELETE"; conversationId: string; messageId: string }
  | { type: "CONVERSATION_READ"; conversationId: string; playerId: string; lastReadAt: Date }
  | { type: "NOTIFICATION_NEW"; notificationId: string; alertType: string; content: string };

type Listener = (event: SocialEvent) => void;

// playerId -> list of active listeners (allowing multiple tabs per player)
const listenerMap = new Map<string, Listener[]>();

export const subscribeSocial = (playerId: string, listener: Listener): (() => void) => {
  const current = listenerMap.get(playerId) ?? [];
  listenerMap.set(playerId, [...current, listener]);

  return () => {
    const existing = listenerMap.get(playerId);

    if (!existing) {
      return;
    }

    const remaining = existing.filter((l) => l !== listener);

    if (remaining.length > 0) {
      listenerMap.set(playerId, remaining);
    } else {
      listenerMap.delete(playerId);
    }
  };
};

export const emitSocial = (playerId: string, event: SocialEvent): void => {
  listenerMap.get(playerId)?.forEach((listener) => listener(event));
};
