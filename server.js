const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const API_KEY = process.env.VPS_API_KEY || 'change-me-to-a-strong-secret';

function authMiddleware(req, res, next) {
  const key = req.headers['x-api-key'];
  if (key !== API_KEY) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  next();
}

const PROVIDERS = [
  { name: 'VidSrc.to', quality: 'HD', movieUrl: (id) => `https://vidsrc.to/embed/movie/${id}`, tvUrl: (id, s, e) => `https://vidsrc.to/embed/tv/${id}/${s}/${e}` },
  { name: 'Vidnest', quality: 'HD', movieUrl: (id) => `https://vidsrc.cc/v2/embed/movie/${id}`, tvUrl: (id, s, e) => `https://vidsrc.cc/v2/embed/tv/${id}/${s}/${e}` },
  { name: 'Embed.su', quality: '1080p', movieUrl: (id) => `https://embed.su/embed/movie/${id}`, tvUrl: (id, s, e) => `https://embed.su/embed/tv/${id}/${s}/${e}` },
  { name: '2Embed', quality: 'HD', movieUrl: (id) => `https://www.2embed.cc/embed/movie?tmdb=${id}`, tvUrl: (id, s, e) => `https://www.2embed.cc/embed/tv?tmdb=${id}&s=${s}&e=${e}` },
  { name: 'Vidzee', quality: '1080p', movieUrl: (id) => `https://vidsrc.xyz/embed/movie/${id}`, tvUrl: (id, s, e) => `https://vidsrc.xyz/embed/tv/${id}/${s}/${e}` },
  { name: 'VidRock', quality: 'HD', movieUrl: (id) => `https://vidsrc.icu/embed/movie/${id}`, tvUrl: (id, s, e) => `https://vidsrc.icu/embed/tv/${id}/${s}/${e}` },
  { name: 'RiveEmbed', quality: '1080p', movieUrl: (id) => `https://rivestream.org/embed?type=movie&id=${id}`, tvUrl: (id, s, e) => `https://rivestream.org/embed?type=tv&id=${id}&s=${s}&e=${e}` },
  { name: 'VidFast', quality: 'HD', movieUrl: (id) => `https://vidfast.pro/movie/${id}`, tvUrl: (id, s, e) => `https://vidfast.pro/tv/${id}/${s}/${e}` },
  { name: 'VidLink', quality: 'HD', movieUrl: (id) => `https://vidlink.pro/movie/${id}`, tvUrl: (id, s, e) => `https://vidlink.pro/tv/${id}/${s}/${e}` },
  { name: 'AutoEmbed', quality: 'HD', movieUrl: (id) => `https://autoembed.co/movie/tmdb/${id}`, tvUrl: (id, s, e) => `https://autoembed.co/tv/tmdb/${id}/${s}/${e}` },
];

async function extractM3U8(browser, url, timeoutMs = 20000) {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  const m3u8Urls = [];
  const mp4Urls = [];

  page.on('request', (req) => {
    const type = req.resourceType();
    if (['image', 'font', 'stylesheet'].includes(type)) { req.abort(); } else { req.continue(); }
  });

  page.on('response', (res) => {
    const resUrl = res.url();
    const contentType = res.headers()['content-type'] || '';
    if (resUrl.includes('.m3u8') || contentType.includes('mpegurl') || contentType.includes('x-mpegURL')) { m3u8Urls.push(resUrl); }
    if ((resUrl.includes('.mp4') && !resUrl.includes('.mp4?')) || contentType.includes('video/mp4')) {
      const contentLength = res.headers()['content-length'];
      if (!contentLength || parseInt(contentLength) > 500000) { mp4Urls.push(resUrl); }
    }
  });

  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await Promise.race([page.waitForNetworkIdle({ idleTime: 3000, timeout: timeoutMs }), new Promise((r) => setTimeout(r, timeoutMs))]);
    try {
      await page.evaluate(() => {
        const btns = document.querySelectorAll('button, .play-button, [class*="play"], [id*="play"], .btn');
        for (const btn of btns) {
          const text = btn.textContent?.toLowerCase() || '';
          if (text.includes('play') || btn.className.toLowerCase().includes('play')) {
            btn.click();
            break;
          }
        }
      });
      await new Promise((r) => setTimeout(r, 5000));
    } catch {}
  } catch (err) {
    console.log(`Navigation error for ${url}: ${err.message}`);
  } finally {
    await page.close();
  }
  return { m3u8: m3u8Urls, mp4: mp4Urls };
}

app.post('/extract', authMiddleware, async (req, res) => {
  const { tmdbId, type = 'movie', season = 1, episode = 1 } = req.body;
  if (!tmdbId) { return res.status(400).json({ success: false, error: 'tmdbId is required' }); }
  const mediaType = type === 'tv' ? 'tv' : 'movie';
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-first-run', '--no-zygote', '--single-process']
    });
    console.log(`Extracting streams for ${mediaType} ${tmdbId}`);
    const results = [];
    for (let i = 0; i < PROVIDERS.length; i += 3) {
      const batch = PROVIDERS.slice(i, i + 3);
      const batchResults = await Promise.allSettled(batch.map(async (provider) => {
        const url = mediaType === 'movie' ? provider.movieUrl(tmdbId) : provider.tvUrl(tmdbId, season, episode);
        console.log(`  Trying ${provider.name}: ${url}`);
        const extracted = await extractM3U8(browser, url);
        if (extracted.m3u8.length > 0 || extracted.mp4.length > 0) {
          return {
            name: provider.name,
            quality: provider.quality,
            url: extracted.m3u8[0] || extracted.mp4[0],
            type: extracted.m3u8.length > 0 ? 'hls' : 'mp4'
          };
        }
        return null;
      }));
      for (const r of batchResults) {
        if (r.status === 'fulfilled' && r.value) {
          results.push(r.value);
        }
      }
      if (results.length >= 2) break;
    }
    console.log(`Found ${results.length} working sources`);
    return res.json({ success: true, sources: results });
  } catch (err) {
    console.error('Extraction error:', err);
    return res.status(500).json({ success: false, error: err.message });
  } finally {
    if (browser) await browser.close();
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Stream extractor running on port ${PORT}`);
});
