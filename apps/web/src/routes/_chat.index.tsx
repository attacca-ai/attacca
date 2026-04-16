import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { useSettings } from "../hooks/useSettings";
import { NoActiveThreadState } from "../components/NoActiveThreadState";

function ChatIndexRouteView() {
  const defaultMode = useSettings((s) => s.defaultMode);
  const navigate = useNavigate();
  const redirectedRef = useRef(false);

  useEffect(() => {
    if (redirectedRef.current) return;
    if (defaultMode === "podium") {
      redirectedRef.current = true;
      void navigate({ to: "/podium", replace: true });
    }
  }, [defaultMode, navigate]);

  return <NoActiveThreadState />;
}

export const Route = createFileRoute("/_chat/")({
  component: ChatIndexRouteView,
});
