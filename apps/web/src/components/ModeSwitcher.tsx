import { memo, useCallback } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { BotIcon, FactoryIcon, LayoutDashboardIcon } from "lucide-react";

import { cn } from "~/lib/utils";

type Mode = "stand" | "podium" | "arco";

interface ModeSwitcherProps {
  readonly className?: string;
}

function resolveCurrentMode(pathname: string): Mode {
  if (pathname === "/podium" || pathname.startsWith("/podium/")) return "podium";
  return "stand";
}

const ModeSwitcher = memo(function ModeSwitcher({ className }: ModeSwitcherProps) {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (loc) => loc.pathname });
  const mode = resolveCurrentMode(pathname);

  const goStand = useCallback(() => {
    void navigate({ to: "/" });
  }, [navigate]);

  const goPodium = useCallback(() => {
    void navigate({ to: "/podium" });
  }, [navigate]);

  return (
    <div
      className={cn(
        "mx-2 mb-1 grid grid-cols-3 gap-0.5 rounded-md border border-border/40 bg-muted/20 p-0.5 text-[11px]",
        className,
      )}
      role="tablist"
      aria-label="Attacca mode"
    >
      <button
        type="button"
        role="tab"
        aria-selected={mode === "stand"}
        onClick={goStand}
        className={cn(
          "flex items-center justify-center gap-1 rounded px-1.5 py-1 font-medium transition-colors",
          mode === "stand"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground/70 hover:text-foreground/80",
        )}
      >
        <LayoutDashboardIcon className="size-3" />
        Stand
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "podium"}
        onClick={goPodium}
        className={cn(
          "flex items-center justify-center gap-1 rounded px-1.5 py-1 font-medium transition-colors",
          mode === "podium"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground/70 hover:text-foreground/80",
        )}
      >
        <FactoryIcon className="size-3" />
        Podium
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={false}
        disabled
        title="Coming in Phase 3"
        className="flex cursor-not-allowed items-center justify-center gap-1 rounded px-1.5 py-1 font-medium text-muted-foreground/30"
      >
        <BotIcon className="size-3" />
        Arco
      </button>
    </div>
  );
});

export default ModeSwitcher;
