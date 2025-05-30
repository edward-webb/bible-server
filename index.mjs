import express from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';  // ✅ <-- FIXED
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(cors());
const PORT = process.env.PORT || 5000;

const ESV_API_KEY = process.env.ESV_API_KEY;
const verses = JSON.parse(fs.readFileSync(path.join('./verses.json'), 'utf8'));
//       <p>Loading original verse...</p>

// /api/facts
app.get('/api/facts', async (req, res) => {
  const passage = req.query.passage || 'John 3:16';
  const results = {};

  try {
    const bibleApi = await axios.get(`https://bible-api.com/${encodeURIComponent(passage)}`);
    results.bibleAPI = bibleApi.data;
  } catch {
    results.bibleAPI = { error: 'Failed to fetch Bible-API' };
  }

  // Labs.Bible removed because they block external servers now (403 error)

  try {
    const esvApi = await axios.get(`https://api.esv.org/v3/passage/text/?q=${encodeURIComponent(passage)}`, {
      headers: { 'Authorization': `Token ${ESV_API_KEY}` }
    });
    results.esv = esvApi.data.passages ? esvApi.data.passages[0] : 'No ESV result';
  } catch {
    results.esv = { error: 'Failed to fetch ESV' };
  }

  try {
    const gotQuestionsPage = await axios.get(`https://www.gotquestions.org/${passage.replace(/\s+/g, '-').replace(/:/g, '-')}.html`);
    const $ = cheerio.load(gotQuestionsPage.data);
    results.gotQuestions = {
      summary: $('meta[name="description"]').attr('content') || 'No summary found',
    };
  } catch (err) {
    console.error('GotQuestions error:', err.message);
    results.gotQuestions = { error: 'Failed to fetch GotQuestions' };
  }

  res.json(results);
});

// /api/original
app.get('/api/original', (req, res) => {
  const input = (req.query.verse || '').toLowerCase().trim();
  const match = input.match(/^([1-3]? ?[a-z ]+)\s+(\d+):(\d+)$/i);
  if (!match) return res.status(400).json({ error: 'Invalid verse format. Use "Book Chapter:Verse"' });

  const key = `${match[1].trim().toLowerCase()} ${match[2]}:${match[3]}`;
  const data = verses[key];

  if (!data) return res.status(404).json({ error: `Verse "${input}" not found in local data.` });

  res.json(data);
});

// /api/Gotanswer
//---------------------------changed------------------------------------------
app.get('/api/answer', async (req, res) => {
  const question = req.query.question;
  if (!question) return res.status(400).json({ error: 'Question is required' });

  const searchQuery = question.trim().replace(/\s+/g, '+');
  const gotQSearchUrl = `https://www.gotquestions.org/search.php?query=${searchQuery}`;
  const googleSearchUrl = `https://www.googleapis.com/customsearch/v1?q=${searchQuery}&key=${process.env.GOOGLE_API_KEY}&cx=${process.env.GOOGLE_CX}`;

  try {
    // First: Try GotQuestions
    const searchPage = await axios.get(gotQSearchUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const $ = cheerio.load(searchPage.data);
    const firstLink = $('a[href*=".html"]').filter((i, el) => $(el).attr('href').startsWith('/')).first().attr('href');

    if (firstLink) {
      const fullArticle = `https://www.gotquestions.org${firstLink}`;
      const articlePage = await axios.get(fullArticle);
      const $$ = cheerio.load(articlePage.data);
      const title = $$('h1').first().text().trim();
      const summary = $$('meta[name="description"]').attr('content') || 'No summary found.';

      return res.json({ title, summary, source: 'GotQuestions.org', link: fullArticle });
    }

    // If GotQuestions fails, try Google CSE
    const googleRes = await axios.get(googleSearchUrl);
    const items = googleRes.data.items;

    if (items && items.length) {
      const first = items[0];
      return res.json({
        title: first.title,
        summary: first.snippet,
        link: first.link,
        source: 'Google CSE'
      });
    }

    return res.json({ summary: 'No answer found from GotQuestions or Google.' });

  } catch (err) {
    console.error('❌ Q&A Fallback Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch answer' });
  }
});

//-----------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`✅ Fixed server running at http://localhost:${PORT}`);
});
// console.log(`✅ Fixed server running at http://localhost:${PORT}`);