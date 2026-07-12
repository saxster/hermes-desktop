import { useEffect } from "react";
import { useTheme } from "../../../components/ThemeProvider";
import { useStore } from "../store";

/** Keep SPS's single theme writer synchronized with a live system preference. */
export function SystemThemeSync(): null {
  const { theme, resolved } = useTheme();
  const dark = useStore((state) => state.t.dark);
  const setTweak = useStore((state) => state.setTweak);

  useEffect(() => {
    if (theme !== "system") return;
    const nextDark = resolved === "dark";
    if (dark !== nextDark) setTweak("dark", nextDark);
  }, [dark, resolved, setTweak, theme]);

  return null;
}
