import { safetyShortcut, setEmergencyOff, watchEmergencyOff } from '../storage/safety';
import type { StudioConnection } from '../studio/connection';

/** Trusted extension UI only. These actions never enter document commands/Undo. */
export function mountSafetyControls(root: HTMLElement, connection?: StudioConnection) {
  const doc = root.ownerDocument,
    section = doc.createElement('section');
  section.className = 'ww-safety-controls';
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
  state.style.cssText = 'margin:0;font-size:11px';
  const help = doc.createElement('details'),
    summary = doc.createElement('summary');
  summary.textContent = '停止キーと操作チェック';
  help.append(summary, key);
  section.append(help);
  root.prepend(section);
  const reportFailure = (error: unknown) => {
    state.textContent = error instanceof Error ? error.message : '停止状態を保存できませんでした。';
  };
  const stop = () => {
    void setEmergencyOff(true).catch(reportFailure);
  };
  const start = () => {
    void setEmergencyOff(false).catch(reportFailure);
  };
  off.addEventListener('click', stop);
  resume.addEventListener('click', start);
  const unwatch = watchEmergencyOff((value) => {
    off.disabled = value;
    resume.hidden = !value;
    state.textContent = value
      ? '緊急OFF中。作品とUndoは保持しています。再開には手動操作が必要です。'
      : '操作面の保護は常に有効です。';
  });
  let alive = true;
  void safetyShortcut()
    .then((shortcut) => {
      if (alive)
        key.textContent =
          '緊急停止キー: ' +
          (shortcut || '未割当・競合の可能性あり') +
          '。chrome://extensions/shortcuts で変更できます。';
    })
    .catch(() => undefined);
  let unsubscribe: (() => void) | undefined;
  let observer: MutationObserver | undefined;
  if (connection?.safety) {
    const label = doc.createElement('label'),
      overlay = doc.createElement('input'),
      report = doc.createElement('ul');
    overlay.type = 'checkbox';
    label.append(overlay, '操作面の保護範囲を表示');
    help.append(label, report);
    let latest: import('../host/operation-guard').SafetyStatus | undefined;
    const badges = () => {
      const host = root.querySelector<HTMLElement>('#web-world-themes-creator');
      if (host?.shadowRoot) observer?.observe(host.shadowRoot, { childList: true, subtree: true });
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
          badge.style.cssText = 'display:inline;white-space:nowrap;font-size:10px;margin-left:4px';
          badge.setAttribute('aria-hidden', 'true');
          (row.querySelector('.layer-type') ?? row).append(badge);
        }
        const text = issues.some((i) => i.severity === 'enforced') ? '制限中' : '助言';
        if (badge.textContent !== text) badge.textContent = text;
        badge.title = issues.map((i) => `${i.surfaceId}: ${i.reason} ${i.remedy}`).join('\n');
      }
    };
    observer = new MutationObserver(badges);
    observer.observe(root, { childList: true, subtree: true });
    overlay.addEventListener('change', () => {
      void connection.safety!.overlay(overlay.checked).catch(reportFailure);
    });
    unsubscribe = connection.safety.subscribe((status) => {
      latest = status;
      overlay.checked = status.overlay;
      report.replaceChildren();
      for (const issue of status.issues) {
        const li = doc.createElement('li');
        li.dataset.layerId = issue.layerId;
        li.dataset.severity = issue.severity;
        li.textContent = `${issue.layerId}: ${issue.severity === 'enforced' ? '制限中' : '助言'} / ${issue.surfaceId} — ${issue.reason} ${issue.remedy}`;
        report.append(li);
      }
      if (status.stopped) {
        const li = doc.createElement('li');
        li.textContent = status.stopped;
        report.append(li);
      }
      summary.textContent = `停止キーと操作チェック${status.issues.length ? `（制限 ${status.issues.length}件）` : ''}`;
      badges();
    });
  }
  return () => {
    alive = false;
    unwatch();
    unsubscribe?.();
    observer?.disconnect();
    section.remove();
  };
}
