import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { CLOUD_SLOTS, GOOGLE_SIGN_IN } from '../platform/cloud';
import { actions, ui } from './store';

const NUDGE_KEY = 'metropolis.signinNudge.v1';

/** How many times this player has said "not now" to signing in. */
export function nudgeDismissals(): number {
  try {
    return Number(localStorage.getItem(NUDGE_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

const when = (ms: number): string => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Menu > Account: sign in with an emailed link (or Google), and save cities to the account. */
export function AccountPanel(): JSX.Element | null {
  const [email, setEmail] = useState('');
  const a = ui.account.value;
  if (!a.enabled) return null;
  if (!a.email) {
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
    return (
      <section>
        <h3 class="label">Account</h3>
        <p class="muted menu-note account-lead">Sign in to keep your cities in your account and carry on from any browser. No password: we email you a sign-in link.</p>
        <label class="field">
          <span>Email</span>
          <input type="email" autoComplete="email" placeholder="you@example.com" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />
        </label>
        <div class="btn-row ai-key-row">
          <button type="button" class="btn" disabled={!valid || a.busy} onClick={() => actions.signIn(email.trim())}>
            Email me a sign-in link
          </button>
          {GOOGLE_SIGN_IN && (
            <button type="button" class="btn" onClick={() => actions.signInGoogle()}>
              Sign in with Google
            </button>
          )}
        </div>
        {a.note && <p class="muted menu-note">{a.note}</p>}
      </section>
    );
  }
  const saved = ui.cloudSaves.value;
  return (
    <section>
      <h3 class="label">Account</h3>
      <div class="ai-key-now">
        <span class="ai-dot on" aria-hidden="true" />
        <span>Signed in as {a.email}</span>
        <button type="button" class="ins-link account-out" onClick={() => actions.signOut()}>
          Sign out
        </button>
      </div>
      {CLOUD_SLOTS.map(([id, name]) => {
        const meta = saved.find((m) => m.slot === id);
        return (
          <div class="loan" key={id}>
            <div>
              <div>{meta ? `${name}: ${meta.cityName}` : name}</div>
              <div class="muted">{meta ? `${meta.population.toLocaleString('en-US')} residents, saved ${when(meta.savedAt)}` : 'Empty'}</div>
            </div>
            <div class="btn-row">
              {id !== 'cloud-auto' && (
                <button type="button" class="btn" disabled={a.busy} onClick={() => actions.cloudSave(id)}>
                  Save
                </button>
              )}
              <button type="button" class="btn" disabled={!meta || a.busy} onClick={() => actions.cloudLoad(id)}>
                Load
              </button>
            </div>
          </div>
        );
      })}
      <p class="muted menu-note">{a.note || 'The cloud autosave updates every five minutes and when you leave the page.'}</p>
    </section>
  );
}

/** On sign-in: offer the latest city in the account, to carry on where the player left off. */
export function ResumeCard(): JSX.Element | null {
  const r = ui.resume.value;
  if (!r || ui.loading.value !== null || ui.intro.value) return null;
  return (
    <div class="panel resume-card" role="dialog" aria-label="Continue your city">
      <div class="goal-banner-kicker">Welcome back</div>
      <div class="resume-title">Continue {r.cityName}?</div>
      <div class="muted">
        {r.population.toLocaleString('en-US')} residents, saved {when(r.savedAt)}
      </div>
      <div class="btn-row ai-key-row">
        <button type="button" class="welcome-go" onClick={() => actions.cloudLoad(r.slot)}>
          Continue
        </button>
        <button type="button" class="btn" onClick={() => (ui.resume.value = null)}>
          Not now
        </button>
      </div>
    </div>
  );
}

/**
 * "Keep your city safe": a card that offers signing in, shown once the city has grown or
 * right after a save in this browser (see Game.nudgeSignIn).
 */
export function SignInNudge(): JSX.Element | null {
  const a = ui.account.value;
  if (!ui.signinNudge.value || !a.enabled || a.email || ui.loading.value !== null || ui.intro.value || ui.resume.value) return null;
  const close = (): void => {
    ui.signinNudge.value = false;
    try {
      localStorage.setItem(NUDGE_KEY, String(nudgeDismissals() + 1));
    } catch {
      /* private window: ask again next visit */
    }
  };
  const openAccount = (): void => {
    ui.signinNudge.value = false;
    ui.showMenu.value = true;
  };
  const city = ui.cityName.value;
  return (
    <div class="panel signin-nudge" role="dialog" aria-label="Keep your city safe">
      <div class="goal-banner-kicker">Keep your city safe</div>
      <div class="signin-title">Save {city} to your account</div>
      <div class="muted">Your city lives in this browser only. Sign in to keep it, and carry on from your phone or any other computer. No password needed.</div>
      <div class="btn-row ai-key-row">
        {GOOGLE_SIGN_IN ? (
          <button type="button" class="welcome-go" onClick={() => ((ui.signinNudge.value = false), actions.signInGoogle())}>
            Sign in with Google
          </button>
        ) : (
          <button type="button" class="welcome-go" onClick={openAccount}>
            Sign in with email
          </button>
        )}
        <button type="button" class="btn" onClick={close}>
          Not now
        </button>
      </div>
    </div>
  );
}
