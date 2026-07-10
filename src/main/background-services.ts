import type { BrowserWindow } from "electron";
import {
  startAssistantRecipeScheduler,
  stopAssistantRecipeScheduler,
} from "./assistant-recipes";
import {
  startEquityAlertWatcher,
  stopEquityAlertWatcher,
} from "./equity-alerts";
import {
  startScheduledResearch,
  stopScheduledResearch,
} from "./scheduled-research";

type WindowGetter = () => BrowserWindow | null;

interface BackgroundServiceDependencies {
  startEquityAlerts: (getWindow: WindowGetter) => void | Promise<void>;
  stopEquityAlerts: () => void;
  startResearch: (getWindow: WindowGetter) => void;
  stopResearch: () => void;
  startAssistantRecipes: (getWindow: WindowGetter) => void;
  stopAssistantRecipes: () => void;
}

const defaultDependencies: BackgroundServiceDependencies = {
  startEquityAlerts: startEquityAlertWatcher,
  stopEquityAlerts: stopEquityAlertWatcher,
  startResearch: startScheduledResearch,
  stopResearch: stopScheduledResearch,
  startAssistantRecipes: startAssistantRecipeScheduler,
  stopAssistantRecipes: stopAssistantRecipeScheduler,
};

export function createBackgroundServiceManager(
  dependencies: BackgroundServiceDependencies = defaultDependencies,
): {
  start: (getWindow: WindowGetter) => void;
  stop: () => void;
} {
  let started = false;

  return {
    start(getWindow) {
      if (started) return;
      started = true;
      void dependencies.startEquityAlerts(getWindow);
      dependencies.startResearch(getWindow);
      dependencies.startAssistantRecipes(getWindow);
    },
    stop() {
      if (!started) return;
      started = false;
      dependencies.stopEquityAlerts();
      dependencies.stopResearch();
      dependencies.stopAssistantRecipes();
    },
  };
}

export const backgroundServices = createBackgroundServiceManager();
