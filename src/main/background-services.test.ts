import { describe, expect, it, vi } from "vitest";
import { createBackgroundServiceManager } from "./background-services";

type Dependencies = NonNullable<
  Parameters<typeof createBackgroundServiceManager>[0]
>;

function createDependencies(): Dependencies {
  return {
    startEquityAlerts: vi.fn(),
    stopEquityAlerts: vi.fn(),
    startResearch: vi.fn(),
    stopResearch: vi.fn(),
    startAssistantRecipes: vi.fn(),
    stopAssistantRecipes: vi.fn(),
  };
}

describe("background service manager", () => {
  it("starts process-owned services only once", () => {
    const dependencies = createDependencies();
    const manager = createBackgroundServiceManager(dependencies);
    const getWindow = vi.fn(() => null);

    manager.start(getWindow);
    manager.start(getWindow);

    expect(dependencies.startEquityAlerts).toHaveBeenCalledOnce();
    expect(dependencies.startResearch).toHaveBeenCalledOnce();
    expect(dependencies.startAssistantRecipes).toHaveBeenCalledOnce();
  });

  it("stops every service once and can be restarted", () => {
    const dependencies = createDependencies();
    const manager = createBackgroundServiceManager(dependencies);
    const getWindow = vi.fn(() => null);

    manager.start(getWindow);
    manager.stop();
    manager.stop();
    manager.start(getWindow);

    expect(dependencies.stopEquityAlerts).toHaveBeenCalledOnce();
    expect(dependencies.stopResearch).toHaveBeenCalledOnce();
    expect(dependencies.stopAssistantRecipes).toHaveBeenCalledOnce();
    expect(dependencies.startResearch).toHaveBeenCalledTimes(2);
  });
});
