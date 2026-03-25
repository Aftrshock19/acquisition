import Link from "next/link";

type BackButtonProps = {
  href?: string;
  label?: string;
  className?: string;
};

export function BackButton({
  href = "/",
  label = "Go home",
  className = "",
}: BackButtonProps) {
  return (
    <Link
      href={href}
      aria-label={label}
      className={`app-icon-button ${className}`.trim()}
    >
      <svg viewBox="0 0 20 20" fill="none" className="h-5 w-5" aria-hidden="true">
        <path
          d="M11.5 4.5L6 10l5.5 5.5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </Link>
  );
}
