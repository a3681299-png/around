import { isAssetId } from '../design/schema';
import { ASSET_READ_TTL_MS, AssetReadError, type AssetReadErrorCode } from '../assets/read-protocol';

interface DocumentOwner {
  tab: number;
  document: string;
  frame: number;
}
interface Grant {
  frame: DocumentOwner;
  expires: number;
  phase: 'open' | 'authorizing' | 'issued' | 'reading' | 'delivering';
  host?: DocumentOwner;
  id?: string;
  token?: string;
}
interface Ports {
  extensionId: string;
  frameURL: string;
  approved(id: string, host: DocumentOwner): Promise<boolean>;
  confirm(host: DocumentOwner, proof: { challenge: string; token: string; id: string }): Promise<boolean>;
  now?: () => number;
}

/** Per-read capabilities. No DOM ticket, renderer, or diagnostic implementation is used. */
export function createAssetReadService(ports: Ports) {
  const now = ports.now ?? Date.now,
    generation = crypto.randomUUID();
  const grants = new Map<string, Grant>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fail = (code: AssetReadErrorCode = 'denied'): never => {
    throw new AssetReadError(
      code,
      code === 'restart' ? '素材取得の再承認が必要です。' : '素材の取得許可がありません。',
    );
  };
  function collect() {
    clearTimeout(timer);
    timer = undefined;
    for (const [key, grant] of grants) if (grant.expires <= now()) grants.delete(key);
    if (grants.size)
      timer = setTimeout(collect, Math.max(1, Math.min(...[...grants.values()].map((g) => g.expires)) - now()));
  }
  function owner(sender: chrome.runtime.MessageSender, frame: boolean): DocumentOwner {
    if (
      sender.id !== ports.extensionId ||
      !Number.isSafeInteger(sender.tab?.id) ||
      sender.tab!.id! < 0 ||
      !sender.documentId ||
      !Number.isSafeInteger(sender.frameId) ||
      (sender.documentLifecycle !== undefined && sender.documentLifecycle !== 'active')
    )
      fail();
    if (
      frame
        ? sender.url !== ports.frameURL ||
          sender.origin !== `chrome-extension://${ports.extensionId}` ||
          sender.frameId! <= 0
        : sender.origin !== 'https://www.youtube.com' ||
          sender.frameId !== 0 ||
          !sender.url?.startsWith('https://www.youtube.com/')
    )
      fail();
    return { tab: sender.tab!.id!, document: sender.documentId!, frame: sender.frameId! };
  }
  const same = (a: DocumentOwner | undefined, b: DocumentOwner) =>
    a?.tab === b.tab && a.document === b.document && a.frame === b.frame;
  function current(message: Record<string, unknown>): { challenge: string; grant: Grant } {
    collect();
    if (message['generation'] !== generation) fail('restart');
    const challenge = message['challenge'];
    if (typeof challenge !== 'string') fail();
    const grant = grants.get(challenge as string);
    if (!grant) fail();
    return { challenge: challenge as string, grant: grant! };
  }
  function active(challenge: string, grant: Grant) {
    if (grants.get(challenge) !== grant || grant.expires <= now()) fail();
  }
  return {
    async handle(message: Record<string, unknown>, sender: chrome.runtime.MessageSender): Promise<unknown> {
      collect();
      if (message['action'] === 'open') {
        const frame = owner(sender, true);
        if (grants.size >= 64 || [...grants.values()].filter((g) => same(g.frame, frame)).length >= 8) fail();
        const challenge = crypto.randomUUID();
        grants.set(challenge, { frame, expires: now() + ASSET_READ_TTL_MS, phase: 'open' });
        collect();
        return { challenge, generation };
      }
      const { challenge, grant } = current(message);
      if (message['action'] === 'authorize') {
        const host = owner(sender, false),
          id = message['id'];
        if (host.tab !== grant.frame.tab || grant.phase !== 'open' || !isAssetId(id)) fail();
        grant.phase = 'authorizing';
        grant.host = host;
        try {
          if (!(await ports.approved(id as string, host))) fail();
          active(challenge, grant);
          grant.id = id as string;
          grant.token = crypto.randomUUID();
          grant.phase = 'issued';
          return { token: grant.token, generation };
        } catch (error) {
          grants.delete(challenge);
          collect();
          throw error;
        }
      }
      if (message['action'] === 'cancel') {
        if (!same(grant.host, owner(sender, false))) fail();
        grants.delete(challenge);
        collect();
        return {};
      }
      const frame = owner(sender, true);
      if (!same(grant.frame, frame)) fail();
      if (message['action'] === 'close') {
        grants.delete(challenge);
        collect();
        return {};
      }
      if (message['token'] !== grant.token || !grant.token || !grant.id) fail();
      if (message['action'] === 'consume') {
        if (grant.phase !== 'issued') fail();
        grant.phase = 'reading';
        return { id: grant.id };
      }
      if (message['action'] === 'deliver') {
        if (grant.phase !== 'reading' || !grant.host) fail();
        grant.phase = 'delivering';
        try {
          const proof = { challenge, token: grant.token!, id: grant.id! };
          if (!(await ports.confirm(grant.host!, proof)) || !(await ports.approved(grant.id!, grant.host!))) fail();
          active(challenge, grant);
          return { allowed: true };
        } finally {
          grants.delete(challenge);
          collect();
        }
      }
      fail();
    },
    revokeTab(tab: number) {
      for (const [id, grant] of grants) if (grant.frame.tab === tab) grants.delete(id);
      collect();
    },
    destroy() {
      grants.clear();
      clearTimeout(timer);
      timer = undefined;
    },
  };
}
