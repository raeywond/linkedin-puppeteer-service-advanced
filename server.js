// server.js
import express from 'express';
import bodyParser from 'body-parser';
import swaggerUi from 'swagger-ui-express';
import swaggerJSDoc from 'swagger-jsdoc';
import {
  createBrowser,
  scrapeProfile,
  scrapeCompany,
  scrapeProfilePosts,
  scrapeCompanyPosts,
  scrapeCompanyJobs
} from './scraper.js';

const app = express();
app.use(bodyParser.json({ limit: '1mb' }));

// --- simple throttle (serialize + random delay) ---
let lastRun = 0;
const delay = (ms) => new Promise(r => setTimeout(r, ms));
async function throttle() {
  const min = Number(process.env.RATE_MIN_MS || 1200);
  const max = Number(process.env.RATE_MAX_MS || 2500);
  const wait = Math.floor(Math.random() * (max - min + 1)) + min;
  const elapsed = Date.now() - lastRun;
  if (elapsed < wait) await delay(wait - elapsed);
  lastRun = Date.now();
}

// --- OpenAPI (Swagger) ---
const swaggerSpec = swaggerJSDoc({
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'LinkedIn Puppeteer Service (Educational)',
      version: '1.3.0'
    },
    servers: [{ url: '/' }]
  },
  apis: ['./server.js']
});
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Health
/**
 * @openapi
 * /health:
 *   get:
 *     summary: Healthcheck
 *     responses:
 *       200:
 *         description: OK
 */
app.get('/health', (_req, res) => res.json({ ok: true }));

/**
 * @openapi
 * /profile:
 *   get:
 *     summary: Scrape a person profile
 *     parameters:
 *       - in: query
 *         name: url
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: login
 *         schema: { type: integer, enum: [0,1] }
 *     responses:
 *       200: { description: OK }
 */
app.get('/profile', async (req, res) => {
  await throttle();
  const url = req.query.url;
  const login = req.query.login === '1' || Boolean(process.env.LINKEDIN_EMAIL);
  if (!url) return res.status(400).json({ error: 'Missing ?url' });

  const browser = await createBrowser();
  try {
    const result = await scrapeProfile(browser, { url, login });
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  } finally {
    try { await browser.close(); } catch {}
  }
});

/**
 * @openapi
 * /profile_posts:
 *   get:
 *     summary: Scrape a person's posts (last N days, best-effort)
 *     parameters:
 *       - in: query
 *         name: url
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: days
 *         schema: { type: integer, default: 30 }
 *       - in: query
 *         name: login
 *         schema: { type: integer, enum: [0,1] }
 *     responses:
 *       200: { description: OK }
 */
app.get('/profile_posts', async (req, res) => {
  await throttle();
  const url = req.query.url;
  const days = Number(req.query.days || 30);
  const login = req.query.login === '1' || Boolean(process.env.LINKEDIN_EMAIL);
  if (!url) return res.status(400).json({ error: 'Missing ?url' });

  const browser = await createBrowser();
  try {
    const data = await scrapeProfilePosts(browser, { url, days, login });
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  } finally {
    try { await browser.close(); } catch {}
  }
});

/**
 * @openapi
 * /company:
 *   get:
 *     summary: Scrape company page
 *     parameters:
 *       - in: query
 *         name: url
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: login
 *         schema: { type: integer, enum: [0,1] }
 *     responses:
 *       200: { description: OK }
 */
app.get('/company', async (req, res) => {
  await throttle();
  const url = req.query.url;
  const login = req.query.login === '1' || Boolean(process.env.LINKEDIN_EMAIL);
  if (!url) return res.status(400).json({ error: 'Missing ?url' });

  const browser = await createBrowser();
  try {
    const data = await scrapeCompany(browser, { url, login });
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  } finally {
    try { await browser.close(); } catch {}
  }
});

/**
 * @openapi
 * /company_posts:
 *   get:
 *     summary: Scrape company posts (last N days, best-effort)
 *     parameters:
 *       - in: query
 *         name: url
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: days
 *         schema: { type: integer, default: 30 }
 *       - in: query
 *         name: login
 *         schema: { type: integer, enum: [0,1] }
 *     responses:
 *       200: { description: OK }
 */
app.get('/company_posts', async (req, res) => {
  await throttle();
  const url = req.query.url;
  const days = Number(req.query.days || 30);
  const login = req.query.login === '1' || Boolean(process.env.LINKEDIN_EMAIL);
  if (!url) return res.status(400).json({ error: 'Missing ?url' });

  const browser = await createBrowser();
  try {
    const data = await scrapeCompanyPosts(browser, { url, days, login });
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  } finally {
    try { await browser.close(); } catch {}
  }
});

/**
 * @openapi
 * /jobs_company:
 *   get:
 *     summary: Scrape company jobs tab
 *     parameters:
 *       - in: query
 *         name: url
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: login
 *         schema: { type: integer, enum: [0,1] }
 *     responses:
 *       200: { description: OK }
 */
app.get('/jobs_company', async (req, res) => {
  await throttle();
  const url = req.query.url;
  const login = req.query.login === '1' || Boolean(process.env.LINKEDIN_EMAIL);
  if (!url) return res.status(400).json({ error: 'Missing ?url (company page)' });

  const browser = await createBrowser();
  try {
    const data = await scrapeCompanyJobs(browser, { url, login });
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  } finally {
    try { await browser.close(); } catch {}
  }
});

/**
 * @openapi
 * /queue:
 *   post:
 *     summary: Run a list of scrape tasks; streams NDJSON if stream=true
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               stream: { type: boolean, default: true }
 *               tasks:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     type:
 *                       type: string
 *                       enum: [profile, profile_posts, company, company_posts, jobs_company]
 *                     url: { type: string }
 *                     days: { type: integer }
 *                     login: { type: integer, enum: [0,1] }
 *     responses:
 *       200: { description: OK }
 */
app.post('/queue', async (req, res) => {
  const { stream = true, tasks = [] } = req.body || {};
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return res.status(400).json({ error: 'Provide tasks: [{type,url,days?,login?}, ...]' });
  }

  if (stream) {
    res.setHeader('Content-Type', 'application/x-ndjson');
  }

  for (const t of tasks) {
    await throttle();
    const login = t.login === 1 || Boolean(process.env.LINKEDIN_EMAIL);
    const browser = await createBrowser();
    let out;
    try {
      if (t.type === 'profile') out = await scrapeProfile(browser, { url: t.url, login });
      else if (t.type === 'profile_posts') out = await scrapeProfilePosts(browser, { url: t.url, days: t.days || 30, login });
      else if (t.type === 'company') out = await scrapeCompany(browser, { url: t.url, login });
      else if (t.type === 'company_posts') out = await scrapeCompanyPosts(browser, { url: t.url, days: t.days || 30, login });
      else if (t.type === 'jobs_company') out = await scrapeCompanyJobs(browser, { url: t.url, login });
      else out = { error: 'unknown_type', type: t.type, url: t.url };

      const payload = { ok: true, type: t.type, url: t.url, result: out };
      if (stream) res.write(JSON.stringify(payload) + '\n'); else (out.payload = payload);
    } catch (e) {
      const err = { ok: false, type: t.type, url: t.url, error: String(e) };
      if (stream) res.write(JSON.stringify(err) + '\n'); else (out = err);
    } finally {
      try { await browser.close(); } catch {}
    }
  }

  if (stream) return res.end();
  return res.json({ ok: true });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log('listening on', port));
