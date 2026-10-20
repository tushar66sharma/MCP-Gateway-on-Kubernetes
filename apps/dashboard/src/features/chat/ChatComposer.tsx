import { Send } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { Textarea } from '../../components/ui/Textarea';
import { MAX_MESSAGE_CHARS } from './api';

export interface ChatComposerProps {
  onSend: (text: string) => void;
  disabled: boolean;
}

/** Enter sends, Shift+Enter adds a newline. The text is cleared on send; the thread keeps it for retry. */
export function ChatComposer({ onSend, disabled }: ChatComposerProps) {
  const [text, setText] = useState('');
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const wasDisabled = useRef(disabled);

  // A disabled textarea drops focus; give it back when the reply arrives.
  useEffect(() => {
    if (wasDisabled.current && !disabled) boxRef.current?.focus();
    wasDisabled.current = disabled;
  }, [disabled]);

  const submit = () => {
    if (disabled || text.trim() === '') return;
    onSend(text);
    setText('');
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter while composing text (IME) confirms the composition; it must not send.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <label htmlFor="chat-message" className="sr-only">
        Message
      </label>
      <Textarea
        id="chat-message"
        ref={boxRef}
        rows={3}
        value={text}
        maxLength={MAX_MESSAGE_CHARS}
        disabled={disabled}
        placeholder="Ask something. Enter sends, Shift+Enter adds a line."
        aria-describedby="chat-counter"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="flex items-center justify-between gap-3">
        <span id="chat-counter" className="text-xs text-fg-subtle tabular-nums">
          {text.length} / {MAX_MESSAGE_CHARS}
        </span>
        <Button type="submit" variant="primary" icon={<Send aria-hidden />} disabled={disabled || text.trim() === ''}>
          Send
        </Button>
      </div>
    </form>
  );
}
