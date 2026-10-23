import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Bot, MessageSquarePlus, Sparkles } from 'lucide-react';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { PageHeader } from '../components/ui/PageHeader';
import { Skeleton } from '../components/ui/Skeleton';
import { budgetLine, budgetResetAt, chatStatusKey, useChatStatus } from '../features/chat/api';
import { ChatComposer } from '../features/chat/ChatComposer';
import { ChatError } from '../features/chat/ChatError';
import { ChatThread } from '../features/chat/ChatThread';
import { useChat } from '../features/chat/useChat';

const DESCRIPTION = 'Ask the assistant to use the gateway’s tools for you.';

const SUGGESTIONS = [
  'What orders came in today?',
  'List the products in the store',
  'What’s 15% of 2,340?',
  'Save a note: call the supplier on Monday',
];

function NotConfigured() {
  return (
    <EmptyState
      icon={<Bot aria-hidden />}
      title="The AI provider isn’t configured"
      description={
        <>
          Follow “Set up the AI chat” in the run guide: put the provider key in <code className="font-mono text-[0.8125rem]">.env</code>, then run{' '}
          <code className="font-mono text-[0.8125rem]">scripts\create-secrets.ps1</code>.
        </>
      }
    />
  );
}

/** True from a CHAT_BUDGET_EXCEEDED error until its `resetsAt`; the timer lifts it at that moment. */
function useBudgetBlock(error: unknown): boolean {
  const resetAt = budgetResetAt(error);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (resetAt === null) return;
    const timer = setTimeout(() => setNow(Math.max(Date.now(), resetAt)), Math.max(0, resetAt - Date.now()));
    return () => clearTimeout(timer);
  }, [resetAt]);
  return resetAt !== null && now < resetAt;
}

export function Chat() {
  const status = useChatStatus();
  const queryClient = useQueryClient();
  // The budget line follows every turn, including one that ended in an error (it may have spent tokens).
  const chat = useChat(() => void queryClient.invalidateQueries({ queryKey: chatStatusKey }));
  const blocked = useBudgetBlock(chat.error);
  const budgetEnded = budgetResetAt(chat.error) !== null && !blocked;

  if (status.isPending) {
    return (
      <>
        <PageHeader title="Chat" description={DESCRIPTION} />
        <div role="status" aria-busy="true" aria-label="Loading chat" className="rounded-card border border-border bg-surface p-5">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="mt-3 h-24 w-full" />
        </div>
      </>
    );
  }
  if (status.isError) {
    return (
      <>
        <PageHeader title="Chat" description={DESCRIPTION} />
        <div className="rounded-card border border-border bg-surface">
          <ErrorState title="Chat didn’t load" error={status.error} onRetry={() => void status.refetch()} retrying={status.isFetching} />
        </div>
      </>
    );
  }
  if (!status.data.configured) {
    return (
      <>
        <PageHeader title="Chat" description={DESCRIPTION} />
        <div className="rounded-card border border-border bg-surface">
          <NotConfigured />
        </div>
      </>
    );
  }

  const { provider, model, budget } = status.data;
  const empty = chat.messages.length === 0;
  return (
    <>
      <PageHeader
        title="Chat"
        description={DESCRIPTION}
        actions={
          <>
            {provider ? (
              <Badge tone="accent">
                {provider}
                {model ? ` · ${model}` : ''}
              </Badge>
            ) : null}
            <Button icon={<MessageSquarePlus aria-hidden />} disabled={empty && !chat.pending} onClick={chat.reset}>
              New conversation
            </Button>
          </>
        }
      />
      {budget ? <p className="mb-2 text-sm text-fg-muted tabular-nums">{budgetLine(budget)}</p> : null}
      <div className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4 sm:p-5">
        {empty && !chat.pending ? (
          <div className="py-6">
            <p className="mb-3 flex items-center gap-2 text-sm font-medium text-fg-muted">
              <Sparkles aria-hidden className="size-4" />
              Try asking
            </p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <Button key={s} size="sm" onClick={() => void chat.send(s)}>
                  {s}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
        <ChatThread messages={chat.messages} pending={chat.pending} />
        {chat.error && !budgetEnded ? <ChatError error={chat.error} pending={chat.pending} onRetry={() => void chat.retry()} /> : null}
        <ChatComposer disabled={chat.pending} {...(blocked && { blockedText: 'Daily AI budget used up' })} onSend={(text) => void chat.send(text)} />
      </div>
    </>
  );
}
