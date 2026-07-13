import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OwnerDeliverySettings as Settings } from "../../../../shared/owner-delivery";
import { OwnerDeliverySettings } from "./OwnerDeliverySettings";

const SETTINGS: Settings = {
  channels: { macos: true, telegram: false, email: false },
  events: {
    "daily-brief": true,
    "scheduled-research": true,
    "gateway-outage": true,
    "follow-up": true,
    "task-proposal": true,
  },
  quietHours: { enabled: true, start: "22:00", end: "07:00" },
  minIntervalMinutes: 15,
  maxPerHour: 6,
};

describe("OwnerDeliverySettings", () => {
  beforeEach(() => {
    window.hermesAPI = {
      getOwnerDeliverySettings: vi.fn().mockResolvedValue(SETTINGS),
      setOwnerDeliverySettings: vi.fn().mockImplementation(async (update) => ({
        ...SETTINGS,
        ...update,
        channels: { ...SETTINGS.channels, ...(update.channels || {}) },
      })),
    } as unknown as Window["hermesAPI"];
  });

  it("loads profile-aware settings and persists channel and rate-limit changes", async () => {
    render(<OwnerDeliverySettings profile="work" />);

    const telegram = await screen.findByLabelText("Telegram home channel");
    fireEvent.click(telegram);
    await waitFor(() =>
      expect(window.hermesAPI.setOwnerDeliverySettings).toHaveBeenCalledWith(
        expect.objectContaining({
          channels: expect.objectContaining({ telegram: true }),
        }),
        "work",
      ),
    );

    fireEvent.change(screen.getByLabelText("Maximum per hour"), {
      target: { value: "3" },
    });
    await waitFor(() =>
      expect(window.hermesAPI.setOwnerDeliverySettings).toHaveBeenCalledWith(
        { maxPerHour: 3 },
        "work",
      ),
    );
  });
});
