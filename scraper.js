// scraper.js
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import dayjs from 'dayjs';
import fs from 'fs';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers: sleep, Redis cookie storage, login-once-and-reuse
// ─────────────────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// File fallback (works only for container lifetime; Redis is the real persistence)
const COOKIES_PATH = process.env.COOKIES_PATH || './cookies.json';

// Upstash Redis (recommended for persistence on free tier)
const REDIS_URL   = process.env.REDIS_REST_URL;   // e.g. https://eu1-xxxx.upstash.io
const REDIS_TOKEN = process.env.REDIS_REST_TOKEN; // '...'
const DEFAULT_KEY = process.env.REDIS_COOKIES_KEY || 'li:cookies';

async function redisGet(key) {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  const res = await fetch(`${REDIS_URL}/GET/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
  });
  if (!res.ok) return null;
  const txt = await res.text();
  return txt === 'null' ? null : txt; // Upstash returns "null" when missing
}

async function redisSet(key, value) {
  if (!REDIS_URL || !REDIS_TOKEN) return false;
  const res = await fetch(
    `${REDIS_URL}/SET/${encodeURIComponent(key)}/${encodeURIComponent(value)}`,
    { method: 'POST', headers: { Authorization: `Bearer ${REDIS_TOKEN}` } }
  );
  return res.ok;
}

async function loadCookies(page, key = DEFAULT_KEY) {
  // Try Redis first
  try {
    const raw = await redisGet(key);
    if (raw) {
      const cookies = JSON.parse(raw);
      if (Array.isArray(cookies) && cookies.length) {
        await page.setCookie(...cookies);
        return true;
      }
    }
  } catch {}

  // Fallback to local file (non-persistent on free tier)
  try {
    if (fs.existsSync(COOKIES_PATH)) {
      const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf-8'));
      if (Array.isArray(cookies) && cookies.length) {
        await page.setCookie(...cookies);
        return true;
      }
    }
  } catch {}

  return false;
}

async function saveCookies(page, key = DEFAULT_KEY) {
  try {
    const cookies = await page.cookies();
    const json = JSON.stringify(cookies);
    if (REDIS_URL && REDIS_TOKEN) await redisSet(key, json); // persist to Redis
    try { fs.writeFileSync(COOKIES_PATH, json); } catch {}   // local fallback
  } catch {}
}

// Ensure we’re logged in, but only if necessary
async function ensureLogin(
  page,
  {
    email = process.env.LINKEDIN_EMAIL,
    password = process.env.LINKEDIN_PASSWORD,
    redisKey = DEFAULT_KEY,
  } = {}
) {
  await loadCookies(page, redisKey);

  // Check if cookies already keep us logged in
  await page.goto('https://www.linkedin.com/feed/', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await sleep(800);

  const onLogin = page.url().includes('/login') || (await page.$('#username'));
  if (!onLogin) return; // already logged in

  if (!email || !password) {
    throw new Error('Missing LINKEDIN_EMAIL / LINKEDIN_PASSWORD and no valid cookies');
  }

  await page.type('#username', email, { delay: 40 });
  await page.type('#password', password, { delay: 40 });
  await Promise.all([
    page.click('button[type=submit]'),
    page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
  ]);
  await sleep(1000);

  await saveCookies(page, redisKey);
}

// ─────────────────────────────────────────────────────────────────────────────
// Puppeteer bootstrap
// ─────────────────────────────────────────────────────────────────────────────
puppeteer.use(StealthPlugin());

function proxyArgs() {
  const proxy = process.env.PROXY_URL;
  return proxy ? [`--proxy-server=${proxy}`] : [];
}

export async function createBrowser() {
  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--window-size=1920,1080',
    ...proxyArgs(),
  ];
  const browser = await puppeteer.launch({
    headless: 'new',
    args,
    defaultViewport: { width: 1200, height: 900 },
  });
  return browser;
}

function looksLikeCaptcha(url, html) {
  return (
    (url && url.includes('checkpoint/challenge')) ||
    (html && /captcha/i.test(html))
  );
}

async function autoScroll(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        let total = 0;
        const distance = 500;
        const timer = setInterval(() => {
          window.scrollBy(0, distance);
          total += distance;
          if (total > window.innerHeight * 8) {
            clearInterval(timer);
            resolve();
          }
        }, 300);
      })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scrapers
// ─────────────────────────────────────────────────────────────────────────────
export async function scrapeProfile(browser, { url, login = false }) {
  const page = await browser.newPage();
  if (process.env.USER_AGENT) await page.setUserAgent(process.env.USER_AGENT);
  await page.setExtraHTTPHeaders({ 'accept-language': 'en-US,en;q=0.9' });

  const proxyUser = process.env.PROXY_USERNAME,
    proxyPass = process.env.PROXY_PASSWORD;
  if (proxyUser && proxyPass)
    await page.authenticate({ username: proxyUser, password: proxyPass });

  if (login) {
    await ensureLogin(page, {
      email: process.env.LINKEDIN_EMAIL,
      password: process.env.LINKEDIN_PASSWORD,
      redisKey: process.env.REDIS_COOKIES_KEY || 'li:cookies',
    });
  }

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1200);

  const html = await page.content();
  if (looksLikeCaptcha(page.url(), html))
    return { error: 'captcha_or_challenge', url: page.url() };

  await autoScroll(page);

  const data = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const qAll = (s) => Array.from(document.querySelectorAll(s));
    const pick = (el) => (el ? el.innerText.trim() : null);

    const name = pick(q('h1'));
    const headline = pick(q('.text-body-medium, .text-body-small, .pv-top-card--list li'));
    const location = pick(q('.text-body-small.t-black--light, .pv-top-card--list-bullet'));
    const about = pick(q('#about, .pv-about-section, .pv-top-card--summary'));

    const experiences = qAll(
      '#experience-section li, .experience-section__list li, section#experience-section li, .pv-profile-section.experience-section ul li'
    )
      .slice(0, 20)
      .map((li) => ({
        title: pick(li.querySelector('h3, .t-16')),
        company: pick(li.querySelector('.pv-entity__secondary-title, .pv-entity__company-summary-info a')),
        dateRange: pick(li.querySelector('.pv-entity__date-range span:last-child, .date-range')),
        location: pick(li.querySelector('.pv-entity__location span:last-child')),
        description: pick(li.querySelector('.pv-entity__description, .description')),
      }));

    const educations = qAll(
      '#education-section li, .education-section__list li, .pv-profile-section.education-section ul li'
    )
      .slice(0, 10)
      .map((li) => ({
        school: pick(li.querySelector('h3, .pv-entity__school-name')),
        degree: pick(li.querySelector('.pv-entity__degree-name .pv-entity__comma-item, .degree')),
        dates: pick(li.querySelector('.pv-entity__dates time')),
      }));

    const skills = qAll('.pv-skill-category-entity__name, .pv-skill-entity__skill-name, .skill-pill')
      .slice(0, 50)
      .map((el) => pick(el))
      .filter(Boolean);

    return { name, headline, location, about, experiences, educations, skills };
  });

  await page.close();
  return { url, scrapedAt: new Date().toISOString(), data };
}

export async function scrapeProfilePosts(browser, { url, days = 30, login = false }) {
  const page = await browser.newPage();
  if (process.env.USER_AGENT) await page.setUserAgent(process.env.USER_AGENT);
  await page.setExtraHTTPHeaders({ 'accept-language': 'en-US,en;q=0.9' });

  if (login) {
    await ensureLogin(page, {
      email: process.env.LINKEDIN_EMAIL,
      password: process.env.LINKEDIN_PASSWORD,
      redisKey: process.env.REDIS_COOKIES_KEY || 'li:cookies',
    });
  }

  let postsUrl = url;
  if (!/detail\/recent-activity/i.test(url)) {
    postsUrl = url.replace(/\/?$/, '/') + 'detail/recent-activity/shares/';
  }
  await page.goto(postsUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1200);
  await autoScroll(page);

  const cutoff = dayjs().subtract(days, 'day');

  const items = await page.evaluate(() => {
    const nodes = Array.from(
      document.querySelectorAll(
        'div.feed-shared-update-v2, div.update-components-update, div.occludable-update'
      )
    );
    const pick = (el) => (el ? el.innerText.trim() : null);
    return nodes.map((n) => {
      const text = pick(
        n.querySelector('[data-test-feed-shared-text], .update-components-text, .break-words')
      );
      const ts =
        n.querySelector('time')?.getAttribute('datetime') ||
        n.querySelector('time')?.innerText ||
        null;
      const urlEl = n.querySelector('a[href*="activity"]');
      const postUrl = urlEl ? urlEl.href : null;
      return { text, timeRaw: ts, postUrl };
    });
  });

  const filtered = items.filter((it) => {
    if (!it.timeRaw) return true;
    const parsed = dayjs(it.timeRaw);
    return parsed.isValid() ? parsed.isAfter(cutoff) : true;
  });

  await page.close();
  return { url: postsUrl, scrapedAt: new Date().toISOString(), days, items: filtered };
}

export async function scrapeCompany(browser, { url, login = false }) {
  const page = await browser.newPage();
  if (process.env.USER_AGENT) await page.setUserAgent(process.env.USER_AGENT);
  await page.setExtraHTTPHeaders({ 'accept-language': 'en-US,en;q=0.9' });

  if (login) {
    await ensureLogin(page, {
      email: process.env.LINKEDIN_EMAIL,
      password: process.env.LINKEDIN_PASSWORD,
      redisKey: process.env.REDIS_COOKIES_KEY || 'li:cookies',
    });
  }

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1000);

  const html = await page.content();
  if (looksLikeCaptcha(page.url(), html))
    return { error: 'captcha_or_challenge', url: page.url() };

  await autoScroll(page);

  const data = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const pick = (el) => (el ? el.innerText.trim() : null);

    const out = {
      name: pick(q('h1')),
      tagline: pick(q('[data-test-id="about-us__tagline"]')),
      about: pick(q('[data-test-id="about-us__description"], .org-grid__content, .break-words')),
      followers: pick(q('[data-test-id="about-us__follower-count"], [data-test-id="followers"]')),
      industry: pick(q('[data-test-id="about-us__industry"]')),
      companySize: pick(
        q(
          '[data-test-id="about-us__company-size"], .org-about-company-module__company-size-definition-text'
        )
      ),
      headquarters: pick(q('[data-test-id="about-us__headquarters"]')),
      founded: pick(q('[data-test-id="about-us__foundedOn"]')),
      specialties: pick(q('[data-test-id="about-us__specialties"]')),
      website: q('a[href^="http"]')?.href || null,
    };

    const empLink = q('a[href*="/people/"]');
    if (empLink && empLink.innerText) out.employeesText = empLink.innerText.trim();

    const badge = q('[data-test-id="about-us__company-employees-on-linkedin"]');
    if (badge && badge.innerText) out.employeesBadge = badge.innerText.trim();

    return out;
  });

  await page.close();
  return { url, scrapedAt: new Date().toISOString(), data };
}

export async function scrapeCompanyPosts(browser, { url, days = 30, login = false }) {
  const page = await browser.newPage();
  if (process.env.USER_AGENT) await page.setUserAgent(process.env.USER_AGENT);
  await page.setExtraHTTPHeaders({ 'accept-language': 'en-US,en;q=0.9' });

  if (login) {
    await ensureLogin(page, {
      email: process.env.LINKEDIN_EMAIL,
      password: process.env.LINKEDIN_PASSWORD,
      redisKey: process.env.REDIS_COOKIES_KEY || 'li:cookies',
    });
  }

  const postsUrl = url.replace(/\/?$/, '/') + 'posts/';
  await page.goto(postsUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1200);
  await autoScroll(page);

  const cutoff = dayjs().subtract(days, 'day');
  const items = await page.evaluate(() => {
    const nodes = Array.from(
      document.querySelectorAll('div.occludable-update, div.feed-shared-update-v2')
    );
    const pick = (el) => (el ? el.innerText.trim() : null);
    return nodes.map((n) => {
      const text = pick(
        n.querySelector('[data-test-feed-shared-text], .update-components-text, .break-words')
      );
      const ts =
        n.querySelector('time')?.getAttribute('datetime') ||
        n.querySelector('time')?.innerText ||
        null;
      const urlEl = n.querySelector('a[href*="posts"]') || n.querySelector('a[href*="activity"]');
      const postUrl = urlEl ? urlEl.href : null;
      return { text, timeRaw: ts, postUrl };
    });
  });

  const filtered = items.filter((it) => {
    if (!it.timeRaw) return true;
    const parsed = dayjs(it.timeRaw);
    return parsed.isValid() ? parsed.isAfter(cutoff) : true;
  });

  await page.close();
  return { url: postsUrl, scrapedAt: new Date().toISOString(), days, items: filtered };
}

export async function scrapeCompanyJobs(browser, { url, login = false }) {
  const page = await browser.newPage();
  if (process.env.USER_AGENT) await page.setUserAgent(process.env.USER_AGENT);
  await page.setExtraHTTPHeaders({ 'accept-language': 'en-US,en;q=0.9' });

  if (login) {
    await ensureLogin(page, {
      email: process.env.LINKEDIN_EMAIL,
      password: process.env.LINKEDIN_PASSWORD,
      redisKey: process.env.REDIS_COOKIES_KEY || 'li:cookies',
    });
  }

  const jobsUrl = url.replace(/\/?$/, '/') + 'jobs/';
  await page.goto(jobsUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1200);
  await autoScroll(page);

  const jobs = await page.evaluate(() => {
    const cards = Array.from(
      document.querySelectorAll('[data-job-id], .jobs-search-results__list-item, .base-card')
    );
    const pick = (el) => (el ? el.innerText.trim() : null);
    return cards.slice(0, 50).map((c) => ({
      title: pick(c.querySelector('h3, .base-search-card__title, .job-card-list__title')),
      location: pick(c.querySelector('.job-card-container__metadata-item, .base-search-card__metadata')),
      listed:
        pick(c.querySelector('time')) ||
        c.querySelector('time')?.getAttribute('datetime') ||
        null,
      jobUrl: c.querySelector('a[href*="/jobs/"]')?.href || null,
    }));
  });

  await page.close();
  return { url: jobsUrl, scrapedAt: new Date().toISOString(), jobs };
}
