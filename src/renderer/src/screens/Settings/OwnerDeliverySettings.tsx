import { useEffect, useState } from "react";
import type {
  OwnerDeliveryChannel,
  OwnerDeliveryEventKind,
  OwnerDeliverySettings as OwnerDeliverySettingsValue,
} from "../../../../shared/owner-delivery";

const CHANNEL_LABELS: Record<OwnerDeliveryChannel, string> = {
  macos: "macOS notifications",
  telegram: "Telegram home channel",
  email: "Email home address",
};

const EVENT_LABELS: Record<OwnerDeliveryEventKind, string> = {
  "daily-brief": "Daily brief",
  "scheduled-research": "Scheduled research",
  "gateway-outage": "Gateway outages",
  "follow-up": "Follow-up reminders",
  "task-proposal": "Task proposals",
};

export function OwnerDeliverySettings({
  profile,
}: {
  profile?: string;
}): React.JSX.Element {
  const [settings, setSettings] = useState<OwnerDeliverySettingsValue | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setSettings(null);
    setError(null);
    void window.hermesAPI
      .getOwnerDeliverySettings(profile)
      .then((value) => {
        if (active) setSettings(value);
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      active = false;
    };
  }, [profile]);

  const save = async (
    update: Partial<OwnerDeliverySettingsValue>,
  ): Promise<void> => {
    if (!settings) return;
    const optimistic: OwnerDeliverySettingsValue = {
      ...settings,
      ...update,
      channels: { ...settings.channels, ...(update.channels || {}) },
      events: { ...settings.events, ...(update.events || {}) },
      quietHours: { ...settings.quietHours, ...(update.quietHours || {}) },
    };
    setSettings(optimistic);
    setError(null);
    try {
      setSettings(
        await window.hermesAPI.setOwnerDeliverySettings(update, profile),
      );
    } catch (err) {
      setSettings(settings);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="settings-section" data-section-tab="preferences">
      <div className="settings-section-title">Owner delivery</div>
      <div className="settings-field-hint" style={{ marginBottom: 12 }}>
        Choose where operator events may reach you. Telegram and email use the
        home targets configured by Hermes Gateway.
      </div>
      {!settings ? (
        <div className="settings-field-hint">
          {error || "Loading delivery preferences…"}
        </div>
      ) : (
        <>
          <div className="settings-field">
            <div className="settings-field-label">Channels</div>
            {Object.entries(CHANNEL_LABELS).map(([channel, label]) => (
              <label key={channel} style={{ display: "block", marginTop: 8 }}>
                <input
                  type="checkbox"
                  checked={settings.channels[channel as OwnerDeliveryChannel]}
                  onChange={(event) =>
                    void save({
                      channels: {
                        ...settings.channels,
                        [channel]: event.target.checked,
                      },
                    })
                  }
                />{" "}
                {label}
              </label>
            ))}
          </div>
          <div className="settings-field">
            <div className="settings-field-label">Events</div>
            {Object.entries(EVENT_LABELS).map(([kind, label]) => (
              <label
                key={kind}
                style={{ display: "inline-block", margin: "8px 16px 0 0" }}
              >
                <input
                  type="checkbox"
                  checked={settings.events[kind as OwnerDeliveryEventKind]}
                  onChange={(event) =>
                    void save({
                      events: {
                        ...settings.events,
                        [kind]: event.target.checked,
                      },
                    })
                  }
                />{" "}
                {label}
              </label>
            ))}
          </div>
          <div className="settings-field">
            <label className="settings-field-label">
              <input
                type="checkbox"
                checked={settings.quietHours.enabled}
                onChange={(event) =>
                  void save({
                    quietHours: {
                      ...settings.quietHours,
                      enabled: event.target.checked,
                    },
                  })
                }
              />{" "}
              Quiet hours
            </label>
            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              <input
                aria-label="Quiet hours start"
                className="input"
                type="time"
                value={settings.quietHours.start}
                disabled={!settings.quietHours.enabled}
                onChange={(event) =>
                  void save({
                    quietHours: {
                      ...settings.quietHours,
                      start: event.target.value,
                    },
                  })
                }
              />
              <input
                aria-label="Quiet hours end"
                className="input"
                type="time"
                value={settings.quietHours.end}
                disabled={!settings.quietHours.enabled}
                onChange={(event) =>
                  void save({
                    quietHours: {
                      ...settings.quietHours,
                      end: event.target.value,
                    },
                  })
                }
              />
            </div>
          </div>
          <div className="settings-field" style={{ display: "flex", gap: 16 }}>
            <label>
              <span className="settings-field-label">Minutes between sends</span>
              <input
                aria-label="Minutes between sends"
                className="input"
                type="number"
                min={0}
                max={1440}
                value={settings.minIntervalMinutes}
                onChange={(event) =>
                  void save({ minIntervalMinutes: Number(event.target.value) })
                }
              />
            </label>
            <label>
              <span className="settings-field-label">Maximum per hour</span>
              <input
                aria-label="Maximum per hour"
                className="input"
                type="number"
                min={1}
                max={100}
                value={settings.maxPerHour}
                onChange={(event) =>
                  void save({ maxPerHour: Number(event.target.value) })
                }
              />
            </label>
          </div>
          {error && <div className="settings-hermes-result error">{error}</div>}
        </>
      )}
    </div>
  );
}
