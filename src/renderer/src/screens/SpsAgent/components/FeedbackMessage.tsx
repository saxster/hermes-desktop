import { Icon } from "./Icon";

export type FeedbackTone = "info" | "success" | "warning" | "error";

const ICONS: Record<FeedbackTone, "info" | "check" | "flag" | "x"> = {
  info: "info",
  success: "check",
  warning: "flag",
  error: "x",
};

export function FeedbackMessage({
  children,
  tone = "info",
}: React.PropsWithChildren<{ tone?: FeedbackTone }>): React.JSX.Element {
  return (
    <div
      className={`sps-feedback ${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <Icon name={ICONS[tone]} size={14} />
      <span>{children}</span>
    </div>
  );
}
