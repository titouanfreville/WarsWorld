/**
 * Notification `content` is a JSON string written by the social backend. Parse it defensively:
 * a malformed/legacy row must never throw during render and take down the whole panel — callers
 * get an empty object and simply render nothing for the missing fields.
 */
export type NotificationPayload = {
  senderName?: string;
  senderId?: string;
};

export const parseNotificationPayload = (content: string): NotificationPayload => {
  try {
    const parsed: unknown = JSON.parse(content);
    return typeof parsed === "object" && parsed !== null ? (parsed as NotificationPayload) : {};
  } catch {
    return {};
  }
};
