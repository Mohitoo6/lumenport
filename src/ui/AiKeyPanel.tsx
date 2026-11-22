import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { PROVIDERS, describeKey, loadOwnKey, saveOwnKey, type ProviderId } from '../game/aiKey';

/**
 * Menu > AI: the shared free AI, or the player's own key. The key is kept in this browser
 * only; the note under the form says exactly where it goes.
 */
export function AiKeyPanel(): JSX.Element {
  const [current, setCurrent] = useState(loadOwnKey());
  const [provider, setProvider] = useState<ProviderId>(current?.provider ?? 'groq');
  const [model, setModel] = useState(current?.model ?? PROVIDERS.groq.model);
  const [key, setKey] = useState('');
  const [editing, setEditing] = useState(false);
  const p = PROVIDERS[provider];
  const save = (): void => {
    const next = { provider, baseUrl: p.baseUrl, model: model.trim() || p.model, apiKey: key.trim() };
    saveOwnKey(next);
    setCurrent(next);
    setKey('');
    setEditing(false);
  };
  const remove = (): void => {
    saveOwnKey(null);
    setCurrent(null);
  };
  return (
    <section>
      <h3 class="label">AI</h3>
      {current && !editing ? (
        <>
          <div class="ai-key-now">
            <span class="ai-dot on" aria-hidden="true" />
            <span>Your key: {describeKey(current)}</span>
          </div>
          <div class="btn-row ai-key-row">
            <button type="button" class="btn" onClick={() => setEditing(true)}>
              Change
            </button>
            <button type="button" class="btn" onClick={remove}>
              Use the free AI
            </button>
          </div>
        </>
      ) : (
        <>
          {!editing && (
            <p class="muted menu-note ai-key-lead">
              The free AI is shared by everyone and limited per player and per day; when it runs out, the council carries on with offline ministers. For unlimited live ministers, add a key of your own.
            </p>
          )}
          <label class="field">
            <span>Provider</span>
            <select
              value={provider}
              onChange={(e) => {
                const id = (e.target as HTMLSelectElement).value as ProviderId;
                setProvider(id);
                setModel(PROVIDERS[id].model);
              }}
            >
              {(Object.keys(PROVIDERS) as ProviderId[]).map((id) => (
                <option value={id} key={id}>
                  {PROVIDERS[id].label}
                </option>
              ))}
            </select>
          </label>
          <label class="field">
            <span>Model</span>
            <input type="text" value={model} spellcheck={false} onInput={(e) => setModel((e.target as HTMLInputElement).value)} />
          </label>
          <label class="field">
            <span>API key</span>
            <input type="password" autoComplete="off" placeholder="Paste key" value={key} onInput={(e) => setKey((e.target as HTMLInputElement).value)} />
          </label>
          <div class="btn-row ai-key-row">
            <button type="button" class="btn" disabled={key.trim().length < 8} onClick={save}>
              Use my key
            </button>
            {editing && (
              <button type="button" class="btn" onClick={() => setEditing(false)}>
                Cancel
              </button>
            )}
          </div>
          <p class="muted menu-note">
            Get a key at {p.keysAt}. It is kept in this browser only, sent with each AI request to the game's server, passed to {p.label.split(' (')[0]} for that call and never stored or logged.
          </p>
        </>
      )}
    </section>
  );
}
