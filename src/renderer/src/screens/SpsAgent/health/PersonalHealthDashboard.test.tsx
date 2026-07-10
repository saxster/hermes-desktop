import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PersonalHealthDashboard } from "./PersonalHealthDashboard";

const api = {
  spsHealthGetProfile: vi.fn(),
  spsHealthGetJournalEntries: vi.fn(),
  spsHealthGetBiometricLogs: vi.fn(),
  spsHealthGetMedicationProtocols: vi.fn(),
  spsHealthGetMedicationLogs: vi.fn(),
  spsHealthGetMedicalDocs: vi.fn(),
  spsRssGetClinicalDigest: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  api.spsHealthGetProfile.mockResolvedValue({ active_conditions: [] });
  api.spsHealthGetJournalEntries.mockResolvedValue([]);
  api.spsHealthGetBiometricLogs.mockResolvedValue([]);
  api.spsHealthGetMedicationProtocols.mockResolvedValue([]);
  api.spsHealthGetMedicationLogs.mockResolvedValue([]);
  api.spsHealthGetMedicalDocs.mockResolvedValue([]);
  api.spsRssGetClinicalDigest.mockResolvedValue([]);
  (window as unknown as { hermesAPI: unknown }).hermesAPI = api;
});

describe("PersonalHealthDashboard", () => {
  it("uses the shared workspace hierarchy with conservative labels and explicit units", async () => {
    const { container } = render(<PersonalHealthDashboard />);

    await waitFor(() => expect(api.spsHealthGetProfile).toHaveBeenCalled());
    expect(screen.getByText("Health")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Daily Log/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Medications/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Records/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Research/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Weight (kg)")).toBeInTheDocument();
    expect(screen.getByLabelText("Fasting Glucose (mg/dL)")).toBeInTheDocument();
    expect(screen.getByLabelText("Blood Pressure (SYS/DIA)")).toBeInTheDocument();
    for (const novelty of ["❤️", "💡", "🎙️", "📸", "📰", "🥗"]) {
      expect(container.textContent).not.toContain(novelty);
    }
    expect(container.querySelector(".emoji-large")).toBeNull();
  });
});
