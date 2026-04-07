import { ThreadId } from "@t3tools/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import ChatView from "../components/ChatView";
import { useComposerDraftStore } from "../composerDraftStore";
import { SidebarInset } from "../components/ui/sidebar";

function DraftChatThreadRouteView() {
  const navigate = useNavigate();
  const { threadId: rawThreadId } = Route.useParams();
  const threadId = rawThreadId as ThreadId;
  const draftThread = useComposerDraftStore((store) => store.getDraftThread(threadId));

  useEffect(() => {
    if (draftThread) {
      return;
    }
    void navigate({ to: "/", replace: true });
  }, [draftThread, navigate]);

  if (!draftThread) {
    return null;
  }

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <ChatView environmentId={draftThread.environmentId} threadId={threadId} routeKind="draft" />
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/draft/$threadId")({
  component: DraftChatThreadRouteView,
});
