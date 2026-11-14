import { safetyShortcut, setEmergencyOff, watchEmergencyOff } from '../browser/safety-store';
import type { StudioConnection } from '../studio/connection';
import type { SafetyStatus } from '../host/operation-guard';

const OFF_STATE = '緊急OFF中。作品とUndoは保持しています。再開には手動操作が必要です。';

/** The stop key and how to change it: told in 表示設定, where the key is set up. */
function describeShortcut(key: HTMLElement, alive: () => boolean) {
  void safetyShortcut()
    .then((shortcut) => {
      if (alive())
        key.textContent =
          '緊急停止キー: ' +
          (shortcut || '未割当・競合の可能性あり') +
          '。chrome://extensions/shortcuts で変更できます。';
    })
    .catch(() => undefined);
}

/** 表示設定 (popup and in-video panel). Trusted extension UI only; these actions never enter
 * document commands/Undo. */
export function mountSafetyControls(root: HTMLElement) {
  const doc = root.ownerDocument,
    section = doc.createElement('section');
  section.className = 'around-safety-controls';
  section.style.cssText =
    'flex:0 0 auto;display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:4px 8px;max-height:160px;overflow:auto';
  section.setAttribute('aria-label', '操作性と緊急停止');
  const off = doc.createElement('button'),
    resume = doc.createElement('button'),
    state = doc.createElement('p'),
    key = doc.createElement('p');
  off.type = resume.type = 'button';
  off.textContent = '緊急OFF';
  resume.textContent = '描画を再開';
  resume.hidden = true;
  state.setAttribute('role', 'status');
  key.className = 'feature-description';
  section.append(off, resume, state, key);
  state.style.cssText = 'margin:0;font-size:12px';
  const help = doc.createElement('details'),
    summary = doc.createElement('summary');
  summary.textContent = '停止キーと操作チェック';
  help.append(summary, key);
  section.append(help);
  root.prepend(section);
  const reportFailure = (error: unknown) => {
    state.textContent = error instanceof Error ? error.message : '停止状態を保存できませんでした。';
  };
  off.addEventListener('click', () => void setEmergencyOff(true).catch(reportFailure));
  resume.addEventListener('click', () => void setEmergencyOff(false).catch(reportFailure));
  const unwatch = watchEmergencyOff((value) => {
    off.disabled = value;
    resume.hidden = !value;
    state.textContent = value ? OFF_STATE : '操作面の保護は常に有効です。';
  });
  let alive = true;
  describeShortcut(key, () => alive);
  return () => {
    alive = false;
    unwatch();
    section.remove();
  };
}

/**
 * The editor's safety, without a band of its own: 緊急OFF is one button in the editor's header, and
 * 操作チェック appears there only while something is restricted (or its overlay is shown). The stop
 * key is told in 表示設定. `header` is placed by the editor into its menu bar (slot "safety").
 */
export function mountEditorSafety(root: HTMLElement, connection: StudioConnection) {
  const doc = root.ownerDocument,
    header = doc.createElement('div');
  header.className = 'around-editor-safety';
  header.slot = 'safety';
  const off = doc.createElement('button'),
    resume = doc.createElement('button'),
    state = doc.createElement('span'),
    check = doc.createElement('details'),
    summary = doc.createElement('summary'),
    popover = doc.createElement('div'),
    label = doc.createElement('label'),
    overlay = doc.createElement('input'),
    report = doc.createElement('ul'),
    restart = doc.createElement('button');
  off.type = resume.type = restart.type = 'button';
  // Shown only once the guard no longer recovers by itself; the page decides again on every input.
  restart.className = 'safety-resume';
  restart.textContent = '描画を再開';
  restart.hidden = true;
  off.className = 'emergency-off';
  off.textContent = '緊急OFF';
  off.title = 'ページ上の描画をすぐに止めます。作品とUndoは保持します。';
  resume.className = 'emergency-resume';
  resume.textContent = '描画を再開';
  resume.hidden = true;
  state.className = 'safety-state';
  state.setAttribute('role', 'status');
  check.className = 'safety-check';
  check.hidden = true;
  summary.setAttribute('aria-label', '操作チェック');
  popover.className = 'safety-popover';
  overlay.type = 'checkbox';
  label.append(overlay, '操作面の保護範囲を表示');
  popover.append(label, report, restart);
  check.append(summary, popover);
  header.append(off, resume, check, state);
  const reportFailure = (error: unknown) => {
    state.textContent = error instanceof Error ? error.message : '停止状態を保存できませんでした。';
  };
  off.addEventListener('click', () => void setEmergencyOff(true).catch(reportFailure));
  resume.addEventListener('click', () => void setEmergencyOff(false).catch(reportFailure));
  const unwatch = watchEmergencyOff((value) => {
    off.hidden = value;
    resume.hidden = !value;
    resume.title = value ? OFF_STATE : '';
    state.textContent = value ? OFF_STATE : '';
  });
  restart.addEventListener('click', () => {
    restart.disabled = true;
    void connection
      .safety!.resume()
      // Its action done, the report folds away like a menu. It used to close only because the
      // guard published an empty list for a moment, which also closed reports opened meanwhile.
      .then(() => {
        if (!check.open) return;
        check.open = false;
        summary.focus();
      })
      .catch(reportFailure)
      .finally(() => {
        restart.disabled = false;
      });
  });
  let latest: SafetyStatus | undefined;
  // Shown while something is restricted or stopped, and while its overlay is on (so it can be put
  // away again); otherwise the header carries 緊急OFF alone.
  const showCheck = () => {
    const issues = latest?.issues.length ?? 0;
    check.hidden = !issues && !latest?.stopped && !overlay.checked;
    if (check.hidden) check.open = false;
    // Short in the header; the full name is the accessible one.
    summary.textContent = issues ? String(issues) : latest?.stopped ? '停止中' : '操作チェック';
    summary.setAttribute('aria-label', issues ? `操作チェック：制限 ${issues}件` : '操作チェック');
    summary.title = summary.getAttribute('aria-label')!;
    check.toggleAttribute('data-restricted', issues > 0 || Boolean(latest?.stopped));
  };
  const badges = () => {
    const host = root.querySelector<HTMLElement>('#around-creator');
    if (host?.shadowRoot) observer.observe(host.shadowRoot, { childList: true, subtree: true });
    for (const row of host?.shadowRoot?.querySelectorAll<HTMLElement>('[data-layer-id]') ?? []) {
      const issues = latest?.issues.filter((i) => i.layerId === row.dataset.layerId) ?? [];
      let badge = row.querySelector<HTMLElement>('.safety-limited-badge');
      if (!issues.length) {
        badge?.remove();
        continue;
      }
      if (!badge) {
        badge = doc.createElement('span');
        badge.className = 'safety-limited-badge';
        badge.style.cssText = 'display:inline;white-space:nowrap;font-size:12px;margin-left:4px';
        badge.setAttribute('aria-hidden', 'true');
        (row.querySelector('.layer-type') ?? row).append(badge);
      }
      const text = issues.some((i) => i.severity === 'enforced') ? '制限中' : '助言';
      if (badge.textContent !== text) badge.textContent = text;
      badge.title = issues.map((i) => `${i.surfaceId}: ${i.reason} ${i.remedy}`).join('\n');
    }
  };
  const observer = new MutationObserver(badges);
  observer.observe(root, { childList: true, subtree: true });
  // The floating report closes like a menu: a press elsewhere or Escape.
  const outside = (event: Event) => {
    if (check.open && !event.composedPath().includes(check)) check.open = false;
  };
  const escape = (event: KeyboardEvent) => {
    if (check.open && event.key === 'Escape') {
      check.open = false;
      summary.focus();
    }
  };
  doc.addEventListener('pointerdown', outside, true);
  doc.addEventListener('keydown', escape, true);
  // A status sent before the tab handled the request must not flip the box back meanwhile.
  let requested: boolean | undefined;
  overlay.addEventListener('change', () => {
    const value = (requested = overlay.checked);
    showCheck();
    void connection
      .safety!.overlay(value)
      .catch(reportFailure)
      .finally(() => {
        if (requested === value) requested = undefined;
        if (latest && requested === undefined) overlay.checked = latest.overlay;
        showCheck();
      });
  });
  const unsubscribe = connection.safety?.subscribe((status) => {
    latest = status;
    if (requested === undefined) overlay.checked = status.overlay;
    report.replaceChildren();
    for (const issue of status.issues) {
      const li = doc.createElement('li');
      // Not data-layer-id: this report sits inside the editor's dialog beside its layer rows.
      li.dataset.issueLayer = issue.layerId;
      li.dataset.severity = issue.severity;
      li.textContent = `${issue.layerId}: ${issue.severity === 'enforced' ? '制限中' : '助言'} / ${issue.surfaceId} — ${issue.reason} ${issue.remedy}`;
      report.append(li);
    }
    if (status.stopped) {
      const li = doc.createElement('li');
      li.className = 'safety-stop';
      li.textContent = status.remedy ? `${status.stopped}${status.remedy}` : status.stopped;
      report.append(li);
    }
    restart.hidden = !status.latched;
    showCheck();
    badges();
  });
  return {
    header,
    destroy() {
      unwatch();
      unsubscribe?.();
      observer.disconnect();
      doc.removeEventListener('pointerdown', outside, true);
      doc.removeEventListener('keydown', escape, true);
      header.remove();
    },
  };
}
