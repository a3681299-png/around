import { isAssetId } from '../design/schema';
import { getAsset } from '../assets/repository';

export const ASSET_LAB_MESSAGE = 'ww.asset-runtime.lab.v1';
/** Profiling builds only. Secrets stay in extension/isolated-world memory, not DOM. */
export function installAssetRuntimeBroker() {
  interface Session {
    tab: number;
    ids: string[];
    expires: number;
    generation: number;
    hostDocument?: string;
    ticket?: string;
    key?: string;
    frameDocument?: string;
  }
  const sessions = new Map<string, Session>(),
    tickets = new Map<string, { session: string; expires: number }>();
  const pageURL = chrome.runtime.getURL('diagnostics/asset-runtime-lab.html');
  function collect() {
    for (const [id, s] of sessions) if (s.expires < Date.now()) sessions.delete(id);
    for (const [id, t] of tickets) if (t.expires < Date.now() || !sessions.has(t.session)) tickets.delete(id);
  }
  async function handle(m: Record<string, unknown>, sender: chrome.runtime.MessageSender) {
    collect();
    const extension = sender.url?.split('?')[0] === pageURL;
    if (m['action'] === 'open') {
      if (
        !extension ||
        sender.frameId !== 0 ||
        !Number.isSafeInteger(m['tab']) ||
        !Array.isArray(m['ids']) ||
        !m['ids'].length ||
        m['ids'].length > 5 ||
        !m['ids'].every(isAssetId)
      )
        throw new Error('Invalid lab authorization');
      if (sessions.size >= 8) throw new Error('Lab session limit');
      for (const id of m['ids']) if (!(await getAsset(id))) throw new Error('Asset not found');
      await chrome.tabs.get(m['tab'] as number);
      const session = crypto.randomUUID();
      sessions.set(session, {
        tab: m['tab'] as number,
        ids: [...new Set(m['ids'])],
        expires: Date.now() + 600000,
        generation: 0,
      });
      return { session };
    }
    if (m['action'] === 'claim') {
      const ticket = typeof m['ticket'] === 'string' && tickets.get(m['ticket']);
      const s = ticket && sessions.get(ticket.session);
      if (
        !extension ||
        !sender.frameId ||
        !sender.documentId ||
        !s ||
        s.tab !== sender.tab?.id ||
        s.ticket !== m['ticket']
      )
        throw new Error('Invalid renderer ticket');
      tickets.delete(m['ticket'] as string);
      s.frameDocument = sender.documentId;
      s.key = crypto.randomUUID();
      return { ids: s.ids, key: s.key, generation: s.generation };
    }
    const session = typeof m['session'] === 'string' && m['session'],
      s = session && sessions.get(session);
    if (
      !s ||
      sender.origin !== 'https://www.youtube.com' ||
      sender.frameId !== 0 ||
      sender.tab?.id !== s.tab ||
      !sender.documentId
    )
      throw new Error('Invalid lab host');
    if (m['action'] === 'attach') {
      s.hostDocument = sender.documentId;
      return {};
    }
    if (s.hostDocument !== sender.documentId) throw new Error('Host document changed');
    if (m['action'] === 'ticket') {
      if (s.ticket) tickets.delete(s.ticket);
      s.generation++;
      delete s.key;
      delete s.frameDocument;
      const ticket = crypto.randomUUID();
      s.ticket = ticket;
      tickets.set(ticket, { session: session as string, expires: Date.now() + 30000 });
      return { ticket, generation: s.generation };
    }
    if (m['action'] === 'bind') {
      if (!s.key || !s.frameDocument || m['generation'] !== s.generation) throw new Error('Renderer not ready');
      return { key: s.key, generation: s.generation };
    }
    if (m['action'] === 'close') {
      sessions.delete(session as string);
      if (s.ticket) tickets.delete(s.ticket);
      return {};
    }
    throw new Error('Unknown lab operation');
  }
  chrome.runtime.onMessage.addListener((input: unknown, sender, respond) => {
    if (
      sender.id !== chrome.runtime.id ||
      !input ||
      typeof input !== 'object' ||
      !('type' in input) ||
      input.type !== ASSET_LAB_MESSAGE
    )
      return false;
    void handle(input as Record<string, unknown>, sender).then(
      (value) => respond({ ok: true, value }),
      (error: unknown) => respond({ ok: false, error: String(error) }),
    );
    return true;
  });
  chrome.tabs.onRemoved.addListener((tab) => {
    for (const [id, s] of sessions) if (s.tab === tab) sessions.delete(id);
    collect();
  });
}
