import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

const featureKey = 'webWorldThemes.features.bbs-comments';
const numbers = '[data-ww-bbs-number]';
const ownedAttributes = [
  'data-ww-bbs',
  'data-ww-bbs-board',
  'data-ww-bbs-row',
  'data-ww-bbs-index',
  'data-ww-bbs-reply',
  'data-ww-bbs-header',
  'data-ww-bbs-owned',
  'data-ww-bbs-number',
  'data-ww-bbs-date',
];

/** Real MV3 content script against both current and legacy native row boundaries.
 * Timestamp values below are explicit test data, not inferred real posting times.
 */
async function installComments(page: Page) {
  await page.goto('https://www.youtube.com/watch?v=fixture');
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = `
      ytd-comment-thread-renderer { display: block; margin: 12px 0; }
      ytd-comment-view-model, ytd-comment-renderer, ytd-comment-replies-renderer { display: block; }
      ytd-comments #body { display: flex; gap: 12px; }
      ytd-comments #main { flex: 1; min-width: 0; }
      ytd-comments #header-author { display: flex; gap: 8px; align-items: center; }
      ytd-comments #published-time-text { font-size: 12px; }
      ytd-comments #content-text { margin-block: 6px; }
      ytd-comments #toolbar { display: flex; gap: 8px; }
      ytd-comments #toolbar button { padding: 4px 8px; }
      ytd-comment-replies-renderer { margin-inline-start: 32px; }
      ytd-comment-replies-renderer.fixture-collapsed { display: none; }
    `;
    document.head.append(style);
    const board = document.querySelector('ytd-comments')!;
    board.innerHTML =
      '<ytd-comments-header-renderer><h2>Comments</h2></ytd-comments-header-renderer><div id="fixture-comment-list"></div>';
    const list = board.querySelector('#fixture-comment-list')!;
    const makeComment = (id: string, legacy: boolean, published: string, extra = '') => {
      const row = document.createElement(legacy ? 'ytd-comment-renderer' : 'ytd-comment-view-model');
      row.setAttribute('data-fixture-comment', id);
      row.innerHTML = `<div id="body"><a class="fixture-avatar" href="/@${id}" aria-label="${id} profile">@</a><div id="main"><div id="header"><div id="header-author"><a id="author-text" href="/@${id}">@${id}</a><span id="published-time-text">${published}</span>${extra}</div></div><div id="content-text"><span>Original ${id}: &lt;keep&gt;  余白\nsecond line <a href="https://example.com/${id}">native link</a></span></div><ytd-comment-engagement-bar id="action-buttons"><div id="toolbar"><button aria-label="Like ${id}">Like</button><span id="vote-count-middle">3.8万</span><button aria-label="Reply ${id}">Reply</button></div></ytd-comment-engagement-bar></div></div>`;
      row.querySelectorAll('button').forEach((button) =>
        button.addEventListener('click', () => {
          button.dataset.clickCount = String(Number(button.dataset.clickCount ?? '0') + 1);
        }),
      );
      return row;
    };
    const comments = [
      makeComment(
        'alpha',
        false,
        '<a href="/watch?v=fixture&lc=alpha"><time datetime="2026-10-04T17:05:42+09:00">4 years ago</time></a>',
      ),
      makeComment(
        'bravo',
        true,
        '<a href="/watch?v=fixture&lc=bravo"><time datetime="2022-10-04">4 years ago</time></a>',
      ),
      makeComment(
        'charlie',
        false,
        '<a href="/watch?v=fixture&lc=charlie" title="2026-10-04T17:05:42+09:00">4 years ago (edited)</a>',
      ),
      makeComment(
        'delta',
        false,
        '<a href="/watch?v=fixture&lc=delta">2 days ago</a>',
        '<meta itemprop="datePublished" content="2026-10-02T02:03:04Z">',
      ),
    ];
    for (const comment of comments) {
      const thread = document.createElement('ytd-comment-thread-renderer');
      thread.setAttribute('data-fixture-thread', comment.getAttribute('data-fixture-comment')!);
      thread.append(comment);
      list.append(thread);
    }
    // Explicit unrelated body/video timestamps must never be used as posting time.
    comments[2]!
      .querySelector('#content-text')!
      .insertAdjacentHTML(
        'beforeend',
        '<time datetime="2026-10-04T17:05:42+09:00">a quoted date</time><meta itemprop="datePublished" content="2026-10-04T17:05:42+09:00">',
      );
    document
      .querySelector('ytd-watch-metadata')!
      .insertAdjacentHTML('beforeend', '<meta itemprop="datePublished" content="2026-10-04T17:05:42+09:00">');
    const original = comments.map((row) => ({
      row,
      text: row.querySelector('#content-text')!,
      html: row.querySelector('#content-text')!.innerHTML,
      date: row.querySelector('#published-time-text')!,
      dateHTML: row.querySelector('#published-time-text')!.innerHTML,
      like: row.querySelector('button')!,
      parent: row.parentElement,
    }));
    (
      window as unknown as {
        bbsFixture: { original: typeof original; makeComment: typeof makeComment; detached?: Element };
      }
    ).bbsFixture = { original, makeComment };
    document.dispatchEvent(new Event('yt-page-data-updated'));
  });
}

async function enable(popup: Page, extra: Record<string, boolean | number> = {}) {
  await popup.evaluate(
    async ({ featureKey, extra }) => {
      await chrome.storage.local.set({
        'webWorldThemes.enabled': true,
        'webWorldThemes.strength': 100,
        [featureKey]: true,
        ...extra,
      });
    },
    { featureKey, extra },
  );
}

async function assertNativeIntact(page: Page) {
  expect(
    await page.evaluate(() => {
      const fixture = (
        window as unknown as {
          bbsFixture: {
            original: Array<{
              row: Element;
              text: Element;
              html: string;
              date: Element;
              dateHTML: string;
              like: Element;
              parent: Element | null;
            }>;
          };
        }
      ).bbsFixture;
      return fixture.original.map((item) => ({
        sameTextNode: item.row.querySelector('#content-text') === item.text,
        exactText: item.text.innerHTML === item.html,
        sameDateNode: item.row.querySelector('#published-time-text') === item.date,
        exactDate: item.date.innerHTML === item.dateHTML,
        sameButton: item.row.querySelector('button') === item.like,
        sameParent: item.row.parentElement === item.parent,
      }));
    }),
  ).toEqual(
    Array.from({ length: 4 }, () => ({
      sameTextNode: true,
      exactText: true,
      sameDateNode: true,
      exactDate: true,
      sameButton: true,
      sameParent: true,
    })),
  );
}

async function expectClean(page: Page) {
  await expect(page.locator(ownedAttributes.map((name) => `[${name}]`).join(', '))).toHaveCount(0);
}

test('BBS uses loaded display-order numbers and exact semantic dates without rewriting native content', async ({
  youtube,
  popup,
}, testInfo) => {
  await installComments(youtube);
  await enable(popup);
  await expect(youtube.locator(numbers)).toHaveText(['1', '2', '3', '4']);
  await expect(youtube.locator('[data-fixture-comment="alpha"] [data-ww-bbs-date]')).toHaveText('2026/10/04(日) 17:05');
  await expect(youtube.locator('[data-fixture-comment="delta"] [data-ww-bbs-date]')).toHaveText('2026/10/02(金) 02:03');
  await expect(
    youtube.locator(
      '[data-fixture-comment="bravo"] [data-ww-bbs-date], [data-fixture-comment="charlie"] [data-ww-bbs-date]',
    ),
  ).toHaveCount(0);
  await expect(youtube.locator('[data-fixture-comment="alpha"] #published-time-text')).toHaveText('4 years ago');
  await assertNativeIntact(youtube);
  for (const name of ['Like alpha', 'Reply alpha']) {
    const button = youtube.getByRole('button', { name, exact: true });
    await button.click();
    await expect(button).toHaveAttribute('data-click-count', '1');
  }
  await expect(youtube.locator('[data-fixture-comment="alpha"] #published-time-text a')).toHaveAttribute(
    'href',
    '/watch?v=fixture&lc=alpha',
  );
  await expect(youtube.locator('[data-fixture-comment="alpha"]')).toHaveCSS('border-top-style', 'dotted');
  await youtube.locator('ytd-comments').scrollIntoViewIfNeeded();
  const path = testInfo.outputPath('bbs-comments.png');
  await youtube.screenshot({ path, fullPage: true, animations: 'disabled' });
  await testInfo.attach('BBS comments preserve native text and actions', { path, contentType: 'image/png' });
});

test('BBS follows sorting, lazy replies, DOM recycling, and changing exact date metadata', async ({
  youtube,
  popup,
}) => {
  await installComments(youtube);
  await enable(popup);
  await expect(youtube.locator(numbers)).toHaveCount(4);
  await youtube.evaluate(() => {
    const fixture = (
      window as unknown as {
        bbsFixture: { makeComment: (id: string, legacy: boolean, published: string) => Element; detached?: Element };
      }
    ).bbsFixture;
    const list = document.querySelector('#fixture-comment-list')!;
    list.prepend(list.lastElementChild!);
    const replies = document.createElement('ytd-comment-replies-renderer');
    replies.id = 'replies';
    replies.append(fixture.makeComment('reply', false, '<a href="/watch?v=fixture&lc=reply">1 minute ago</a>'));
    document.querySelector('[data-fixture-thread="alpha"]')!.append(replies);
  });
  await expect(youtube.locator(numbers)).toHaveText(['1', '2', '3', '4', '5']);
  await expect(youtube.locator('[data-fixture-comment="delta"]')).toHaveAttribute('data-ww-bbs-index', '1');
  await expect(youtube.locator('[data-fixture-comment="reply"]')).toHaveAttribute('data-ww-bbs-index', '3');
  await expect(youtube.locator('[data-fixture-comment="reply"]')).toHaveAttribute('data-ww-bbs-reply', '');
  const replies = youtube.locator('ytd-comment-replies-renderer');
  await replies.evaluate((element) => element.setAttribute('hidden', ''));
  await expect(youtube.locator(numbers)).toHaveText(['1', '2', '3', '4']);
  await expect(youtube.locator('[data-fixture-comment="reply"]')).toHaveCount(1);
  await expect(youtube.locator('[data-fixture-comment="reply"] [data-ww-bbs-number]')).toHaveCount(0);
  await expect(youtube.locator('[data-fixture-comment="bravo"]')).toHaveAttribute('data-ww-bbs-index', '3');
  await replies.evaluate((element) => element.removeAttribute('hidden'));
  await expect(youtube.locator(numbers)).toHaveText(['1', '2', '3', '4', '5']);
  await replies.evaluate((element) => element.classList.add('fixture-collapsed'));
  await expect(youtube.locator(numbers)).toHaveText(['1', '2', '3', '4']);
  await replies.evaluate((element) => element.classList.remove('fixture-collapsed'));
  await expect(youtube.locator(numbers)).toHaveText(['1', '2', '3', '4', '5']);
  await replies.evaluate((element) => element.setAttribute('aria-expanded', 'false'));
  await expect(youtube.locator(numbers)).toHaveText(['1', '2', '3', '4']);
  await replies.evaluate((element) => element.setAttribute('aria-expanded', 'true'));
  await expect(youtube.locator(numbers)).toHaveText(['1', '2', '3', '4', '5']);
  await youtube.getByRole('button', { name: 'Reply reply', exact: true }).click();
  await expect(youtube.getByRole('button', { name: 'Reply reply', exact: true })).toHaveAttribute(
    'data-click-count',
    '1',
  );

  await youtube
    .locator('[data-fixture-comment="alpha"] time')
    .evaluate((element) => element.setAttribute('datetime', '2026-10-05T08:09:10+09:00'));
  await expect(youtube.locator('[data-fixture-comment="alpha"] [data-ww-bbs-date]')).toHaveText('2026/10/05(月) 08:09');
  await youtube
    .locator('[data-fixture-comment="alpha"] time')
    .evaluate((element) => element.removeAttribute('datetime'));
  await expect(youtube.locator('[data-fixture-comment="alpha"] [data-ww-bbs-date]')).toHaveCount(0);

  await youtube.evaluate(() => {
    const alpha = document.querySelector('[data-fixture-comment="alpha"]')!;
    alpha.querySelector('#header-author')!.innerHTML =
      '<a id="author-text" href="/@replacement">@replacement</a><span id="published-time-text"><a href="/watch?v=fixture&lc=replacement">just now</a></span>';
    for (let index = 0; index < 5; index++) document.dispatchEvent(new Event('yt-page-data-updated'));
  });
  await expect(youtube.locator('[data-fixture-comment="alpha"] [data-ww-bbs-number]')).toHaveCount(1);
  await expect(youtube.locator('[data-fixture-comment="alpha"] #header-author > [data-ww-bbs-number]')).toHaveText('2');
  await expect(youtube.locator('[data-fixture-comment="alpha"] #published-time-text')).toHaveText('just now');
  await youtube.evaluate(() => {
    const removed = document.querySelector('[data-fixture-thread="bravo"]')!;
    (window as unknown as { bbsFixture: { detached?: Element } }).bbsFixture.detached = removed;
    removed.remove();
  });
  await expect(youtube.locator(numbers)).toHaveText(['1', '2', '3', '4']);
  await youtube.evaluate(() => {
    const existing = document.querySelector('[data-fixture-thread="charlie"]')!;
    existing.replaceWith(existing.cloneNode(true));
  });
  await expect(youtube.locator(numbers)).toHaveText(['1', '2', '3', '4']);
  await expect(youtube.locator('[data-fixture-comment="charlie"] [data-ww-bbs-number]')).toHaveCount(1);
  await expect
    .poll(() =>
      youtube.evaluate(() => {
        const detached = (window as unknown as { bbsFixture: { detached: Element } }).bbsFixture.detached;
        return detached.querySelectorAll('[data-ww-bbs-row], [data-ww-bbs-number], [data-ww-bbs-index]').length;
      }),
    )
    .toBe(0);
});

test('BBS feature OFF, global OFF, and zero remove all owned nodes and observers, then remount once', async ({
  youtube,
  popup,
}) => {
  await installComments(youtube);
  await enable(popup);
  await expect(youtube.locator(numbers)).toHaveCount(4);
  const patches: Array<Record<string, boolean | number>> = [
    { [featureKey]: false },
    { 'webWorldThemes.strength': 0 },
    { 'webWorldThemes.enabled': false },
  ];
  for (const patch of patches) {
    await popup.evaluate(async (patch) => {
      await chrome.storage.local.set(patch);
    }, patch);
    await expectClean(youtube);
    await assertNativeIntact(youtube);
    await youtube.locator('[data-fixture-comment="alpha"] #content-text').evaluate((element) => {
      element.append(document.createTextNode(''));
      document.dispatchEvent(new Event('yt-page-data-updated'));
    });
    await expectClean(youtube);
    await enable(popup);
    await expect(youtube.locator(numbers)).toHaveText(['1', '2', '3', '4']);
  }
  await assertNativeIntact(youtube);
});

test('BBS clears on SPA navigation and restarts numbering for the replacement board', async ({ youtube, popup }) => {
  await installComments(youtube);
  await enable(popup);
  await expect(youtube.locator(numbers)).toHaveCount(4);
  await youtube.evaluate(() => document.dispatchEvent(new Event('yt-navigate-start')));
  await expectClean(youtube);
  await youtube.evaluate(() => {
    const oldBoard = document.querySelector('ytd-comments')!;
    const next = document.createElement('ytd-comments');
    next.innerHTML =
      '<ytd-comment-thread-renderer><div><b id="author-text">@next</b><span id="published-time-text">just now</span><p id="content-text">Next page, native legacy text</p><button aria-label="Reply next">Reply</button></div></ytd-comment-thread-renderer>';
    oldBoard.replaceWith(next);
    history.pushState({}, '', '/watch?v=next');
    document.dispatchEvent(new Event('yt-navigate-finish'));
  });
  await expect(youtube.locator(numbers)).toHaveText(['1']);
  await expect(youtube.locator('[data-ww-bbs-date]')).toHaveCount(0);
  await expect(youtube.getByRole('button', { name: 'Reply next', exact: true })).toBeVisible();
  await youtube.evaluate(() => {
    document.dispatchEvent(new Event('yt-navigate-start'));
    document.querySelector('ytd-comments')!.remove();
    history.pushState({}, '', '/');
    document.dispatchEvent(new Event('yt-navigate-finish'));
  });
  await expectClean(youtube);
});
