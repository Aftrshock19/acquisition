import Link from "next/link";
import { Settings2 } from "lucide-react";

type SettingsButtonProps = {
  href?: string;
  label?: string;
  className?: string;
};

export function SettingsButton({
  href = "/settings",
  label = "Open settings",
  className = "",
}: SettingsButtonProps) {
  return (
    <Link
      href={href}
      aria-label={label}
      className={`app-icon-button ${className}`.trim()}
    >
      <Settings2 className="h-5 w-5" aria-hidden="true" strokeWidth={1.8} />
    </Link>
  );
}
