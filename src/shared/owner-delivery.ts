export type OwnerDeliveryChannel = "macos" | "telegram" | "email";

export type OwnerDeliveryEventKind =
  | "daily-brief"
  | "scheduled-research"
  | "gateway-outage"
  | "follow-up"
  | "task-proposal";

export interface OwnerDeliverySettings {
  channels: Record<OwnerDeliveryChannel, boolean>;
  events: Record<OwnerDeliveryEventKind, boolean>;
  quietHours: {
    enabled: boolean;
    start: string;
    end: string;
  };
  minIntervalMinutes: number;
  maxPerHour: number;
}

export interface OwnerDeliveryEvent {
  id: string;
  kind: OwnerDeliveryEventKind;
  title: string;
  body: string;
}

export interface OwnerDeliveryAttempt {
  eventId: string;
  channel: OwnerDeliveryChannel;
  deliveredAt: number;
}

export interface OwnerDeliveryResult {
  delivered: OwnerDeliveryChannel[];
  skipped: Array<{
    channel: OwnerDeliveryChannel;
    reason:
      | "disabled"
      | "event-disabled"
      | "quiet-hours"
      | "rate-limit"
      | "duplicate"
      | "failed";
  }>;
}
