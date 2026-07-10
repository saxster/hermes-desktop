// store/index.ts — composes all slices into the SPS workspace store. Mounted
// lifecycle side effects live in lifecycle.ts so importing state is inert.
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { Store } from "./storeTypes";
import { createWorkspaceSlice } from "./slices/workspace";
import { createCommentsSlice } from "./slices/comments";
import { createUiSlice } from "./slices/ui";
import { createSidebarSlice } from "./slices/sidebar";
import { createTweaksSlice } from "./slices/tweaks";
import { createTemplatesSlice } from "./slices/templates";
import { createCockpitSlice } from "./slices/cockpit";
import { createAssistantSlice } from "./slices/assistant";
import { createJournalSlice } from "./slices/journal";
import { createExternalContextSlice } from "./slices/externalContext";

export const useStore = create<Store>()(
  subscribeWithSelector((...a) => ({
    ...createWorkspaceSlice(...a),
    ...createCommentsSlice(...a),
    ...createUiSlice(...a),
    ...createSidebarSlice(...a),
    ...createTweaksSlice(...a),
    ...createTemplatesSlice(...a),
    ...createCockpitSlice(...a),
    ...createAssistantSlice(...a),
    ...createJournalSlice(...a),
    ...createExternalContextSlice(...a),
  })),
);
