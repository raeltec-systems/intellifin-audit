import { useEffect, useState } from 'react';
import { readHealth } from './health';
import type { Health } from './health';

type CheckResult = { state: 'checking' } | { state: 'done'; health: Health } | { state: 'failed' };
const checking: CheckResult = { state: 'checking' };

function label(result: CheckResult): string {
  if (result.state === 'checking') return 'Checking…';
  if (result.state === 'failed') return 'Could not check';
  if (result.health.status === 'unavailable') return 'Unavailable';
  return result.health.status === 'live' ? 'Responding' : 'Ready';
}

function StatusRow({ title, description, result }: {
  title: string;
  description: string;
  result: CheckResult;
}) {
  const available = result.state === 'done' && result.health.status !== 'unavailable';
  return (
    <div className="status-row">
      <div><h3>{title}</h3><p>{description}</p></div>
      <span className={`status-label${available ? ' available' : ''}`}>{label(result)}</span>
    </div>
  );
}

export function App() {
  const [attempt, setAttempt] = useState(0);
  const [live, setLive] = useState<CheckResult>(checking);
  const [ready, setReady] = useState<CheckResult>(checking);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    // A timeout is a failed check; cleanup must not update an unmounted screen.
    // Let the API's five-second readiness deadline return its truthful 503 first.
    const timeout = setTimeout(() => controller.abort(), 8000);
    const signal = controller.signal;
    const request = async () => {
      const results = await Promise.allSettled([readHealth('live', signal), readHealth('ready', signal)]);
      if (!active) return;
      const result = (value: PromiseSettledResult<Health>): CheckResult =>
        value.status === 'fulfilled' ? { state: 'done', health: value.value } : { state: 'failed' };
      setLive(result(results[0]));
      setReady(result(results[1]));
      setCheckedAt(new Date());
      clearTimeout(timeout);
    };
    void request();
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [attempt]);

  const pending = live.state === 'checking' || ready.state === 'checking';
  const unavailable = live.state === 'failed' || ready.state === 'failed' ||
    (live.state === 'done' && live.health.status === 'unavailable') ||
    (ready.state === 'done' && ready.health.status === 'unavailable');

  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace">Skip to workspace</a>
      <aside className="sidebar" aria-label="Workspace navigation">
        <img className="brand-lockup" src="/assets/zobba-lockup-color.svg" alt="Zobba" width="132" height="32" />
        <nav aria-label="Main"><a href="#workspace" aria-current="page"><span aria-hidden="true">⌂</span> Overview</a></nav>
        <div className="sidebar-note"><span className="pair-label">Pair</span><p>Workspace foundation</p><span>Local development</span></div>
      </aside>

      <div className="workspace">
        <header className="workspace-header"><span>Workspace</span><span className="setup-label">In setup</span></header>
        <main id="workspace" tabIndex={-1}>
          <div className="intro">
            <img src="/assets/zobba-symbol-color.svg" alt="" width="40" height="40" />
            <p className="eyebrow">Zobba · Foundation</p>
            <h1>Your Zobba workspace</h1>
            <p className="intro-copy">A quiet place for the work ahead. This first build checks the connection to your workspace.</p>
          </div>

          <section className="connection-panel" aria-labelledby="connection-title">
            <div className="panel-heading"><h2 id="connection-title">Connection status</h2><span className="panel-caption">Checked on request</span></div>
            <div role="status" aria-live="polite" aria-atomic="true">
              <StatusRow title="Application service" description="Checks whether the service responds to requests." result={live} />
              <StatusRow title="Workspace storage" description="Checks access to the prepared workspace database." result={ready} />
            </div>
            <div className="panel-footer">
              <p>{pending ? 'Checking the current connection…' : checkedAt ? <>Last checked <time dateTime={checkedAt.toISOString()}>{checkedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time></> : 'No check recorded.'}</p>
              <button type="button" aria-disabled={pending} onClick={() => {
                if (pending) return;
                setLive(checking); setReady(checking); setAttempt((value) => value + 1);
              }}>Check again</button>
            </div>
          </section>

          {unavailable ? <p className="connection-help">The workspace connection is unavailable. Start or restore the local service, then check again.</p> : null}
          <p className="scope-note">Engagement access and audit work are not available in this foundation build.</p>
        </main>
      </div>
    </div>
  );
}
