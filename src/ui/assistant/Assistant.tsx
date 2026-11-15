import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { actions, ui } from '../store';
import './assistant.css';

const SUGGESTIONS = ['Why are my homes not being built?', 'What should I build next?', 'Why is my money going down?', 'मेरा शहर क्यों नहीं बढ़ रहा?'];

function IconSpark(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M8 1.8v2.6M8 11.6v2.6M1.8 8h2.6M11.6 8h2.6M3.6 3.6l1.8 1.8M10.6 10.6l1.8 1.8M12.4 3.6l-1.8 1.8M5.4 10.6l-1.8 1.8" />
      <circle cx="8" cy="8" r="1.6" />
    </svg>
  );
}

/** Top-bar button that opens the assistant. */
export function AssistantButton(): JSX.Element {
  const open = ui.assistant.value.open;
  return (
    <button
      type="button"
      class={`panel assistant-btn${open ? ' is-on' : ''}`}
      aria-expanded={open}
      title="Ask the assistant"
      onClick={() => (ui.assistant.value = { ...ui.assistant.value, open: !open })}
    >
      <IconSpark />
      <span>Ask</span>
    </button>
  );
}

/** The chat with the mayor's assistant. */
export function AssistantPanel(): JSX.Element | null {
  const a = ui.assistant.value;
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [a.messages.length, a.busy, a.open]);
  useEffect(() => {
    if (a.open) input.current?.focus();
  }, [a.open]);
  if (!a.open) return null;
  const send = (q: string): void => {
    if (!q.trim() || a.busy) return;
    actions.askAssistant(q);
    setText('');
  };
  return (
    <aside class="panel assistant" aria-label="Assistant">
      <div class="panel-head">
        <div>
          <h2>Assistant</h2>
          <div class="muted small">Answers from your city’s live data</div>
        </div>
        <div class="assistant-head-btns">
          {a.messages.length > 0 && (
            <button type="button" class="link-btn" onClick={() => actions.clearAssistant()}>
              Clear
            </button>
          )}
          <button type="button" class="icon-btn" aria-label="Close the assistant" onClick={() => (ui.assistant.value = { ...a, open: false })}>
            ×
          </button>
        </div>
      </div>
      <div class="assistant-log" aria-live="polite">
        {a.messages.length === 0 && (
          <div class="assistant-empty">
            <p class="muted">Ask anything about your city: why something isn’t building, what to do next, or how a tool works. English, Hindi or Hinglish.</p>
            <div class="chips">
              {SUGGESTIONS.map((s) => (
                <button type="button" class="chip" key={s} onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {a.messages.map((m) => (
          <div key={m.id} class={`bubble is-${m.role}`}>
            <p lang={/[ऀ-ॿ]/.test(m.text) ? 'hi' : 'en'}>{m.text}</p>
            {m.actions && m.actions.length > 0 && (
              <div class="bubble-actions">
                {m.actions.map((act, i) => (
                  <button type="button" class={`btn${i === 0 ? ' btn-go' : ''}`} key={i} onClick={() => actions.assistantAction(act)}>
                    {act.label}
                  </button>
                ))}
              </div>
            )}
            {m.source === 'offline' && <div class="bubble-note">Offline answer from the city’s warnings</div>}
            {m.flags && m.flags.length > 0 && (
              <div class="bubble-note is-flag" title="Checked by code against the rules and city data the assistant was given">
                Unverified figure{m.flags.length > 1 ? 's' : ''}: {m.flags.join(', ')}
              </div>
            )}
          </div>
        ))}
        {a.busy && (
          <div class="bubble is-assistant is-busy" aria-label="Thinking">
            <span class="dots inline">
              <i />
              <i />
              <i />
            </span>
          </div>
        )}
        <div ref={end} />
      </div>
      <form
        class="assistant-form"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <textarea
          ref={input}
          rows={2}
          maxLength={600}
          placeholder="e.g. Why can't I build a road here?"
          value={text}
          onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send(text);
            }
            if (e.key === 'Escape') ui.assistant.value = { ...a, open: false };
          }}
        />
        <button type="submit" class="btn btn-go" disabled={!text.trim() || a.busy}>
          Ask
        </button>
      </form>
    </aside>
  );
}
