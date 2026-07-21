// autofill.ts — "autofill, not data entry" IPC. The renderer asks for AI
// property suggestions on an entity row (v1: people + projects); the result
// lands as update-frontmatter operations in the AI Review Queue, never as a
// direct write.
import { safeHandle } from "../safe-handle";
import { requireLocalWorkspace } from "../connection-guards";
import { proposePropertyAutofillNow } from "../../property-autofill";

export function registerSpsAutofillIpc(): void {
  safeHandle(
    "sps-propose-property-autofill",
    (_event, folder: string, rowId: string, profile?: string) => {
      requireLocalWorkspace();
      return proposePropertyAutofillNow(folder, rowId, profile);
    },
  );
}
