const express = require('express');
const Parser = require('rss-parser');
const fs = require('fs');
require('dotenv').config();

const app = express();
const parser = new Parser();
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Hårdkodade källor
const sources = [
  { name: 'Bohuslaningen', url: 'https://www.bohuslaningen.se/rss' },
  { name: 'TTELA', url: 'https://www.ttela.se/rss' },
  { name: 'Stromstads Tidning', url: 'https://www.stromstadstidning.se/rss' },
  { name: 'Melleruds Nyheter', url: 'https://www.mellerudsnyheter.se/rss' },
  { name: 'SVT Vast', url: 'https://www.svt.se/nyheter/lokalt/vast/rss.xml' },
  { name: 'Dagens Nyheter', url: 'https://www.dn.se/rss' },
  { name: 'Goterborgsposten', url: 'https://www.gp.se/rss' }
 // { name: 'Vastsvenskan', url: 'https://www.vastsvenskan.se/rss' }
];

const ARTICLES_FILE = 'articles.json';

app.use(express.static('public'));
app.use(express.json());

function mentionsAny(title, content, terms) {
  const text = (title + ' ' + content).toLowerCase();
  return terms.some(term => text.includes(term.toLowerCase()));
}

function getMatchedTerms(title, content, terms) {
  const text = (title + ' ' + content).toLowerCase();
  return terms.filter(term => text.includes(term.toLowerCase()));
}

function getDate(iso) {
  return iso ? new Date(iso).toISOString().split('T')[0] : 'unknown';
}

async function fetchFeed(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    const body = await res.text();
    const feed = await parser.parseString(body);
    return feed.items || [];
  } catch (e) {
    console.error('Fel vid hamtning fran ' + url + ':', e.message);
    return [];
  }
}

function loadArticles() {
  if (!fs.existsSync(ARTICLES_FILE)) return [];
  const data = fs.readFileSync(ARTICLES_FILE, 'utf8');
  return JSON.parse(data);
}

function saveArticles(articles) {
  fs.writeFileSync(ARTICLES_FILE, JSON.stringify(articles, null, 2), 'utf8');
}

async function analyzeWithClaude(todayArticles, searchTerms) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY inte satt i .env');
    return '';
  }

  const articlesText = todayArticles.map(a => 
    a.title + ' (' + a.source + ')\n' + a.description + '\n[Länk: ' + a.link + ']'
  ).join('\n\n');

  //const prompt = 'Du ar en kommunikationsradgivare for en svensk kommun.\n\nHar ar artiklar fran idag som namner dessa sokord: ' + searchTerms.join(', ') + '\n\n' + articlesText + '\n\nAnalysera:\n1. Vilka ar de viktigaste nyheterna?\n2. Finns det något som kraver ett proaktivt svar fran kommunen?\n3. Vilken ton har artiklarna (positiv/negativ/neutral)?\n4. Foreslå ett kort holding statement (2-3 meningar) som kommunen kan anvanda om de blir tillfrågade. Inkludera länkarna till artiklarna i ditt svar.\n\nSvara pa svenska.';
    const prompt = `Du är en senior kommunikationsrådgivare och medieanalytiker för Uddevalla kommun.

Här är dagens insamlade medieartiklar (från lokala och regionala nyhetsflöden):
${articlesText}

De definierade bevakningsområdena är: ${searchTerms.join(', ')}.

Gör en strategisk nyhetsanalys utifrån följande instruktioner:

1. SEMANTISK KATEGORISERING (Leta efter resonemang, inte bara exakta ord):
- Sortera artiklarna under dina bevakningsområden baserat på textens faktiska sammanhang. 
- Exempelvis ska artiklar om partidebatter, motioner eller beslut i kommunhuset kategoriseras som "Politik & Styrning", även om ordet "politik" saknas. Artiklar om vägarbeten, broar, eller kollektivtrafik ska till "Infrastruktur".

2. MEDIELOGIK & RISKBEDÖMNING:
- Identifiera artiklarnas ton (Positiv, Negativ eller Neutral).
- Analysera den underliggande konflikten: Finns det ett medborgarperspektiv, en kritik mot kommunen, eller en potentiell förtroenderisk (t.ex. kring trygghet eller ekonomi)?

3. SVARS-ASSISTENT & REKOMMENDATION:
- Bedöm om artikeln kräver ett proaktivt eller reaktivt svar från kommunen (Ja/Nej) och motivera varför.
- Formulera ett kort "Holding Statement" (2-3 meningar) för de artiklar som innebär en kommunikationsrisk. Detta ska fungera som ett första officiellt svar till media eller medborgare.

Presentera analysen i ett strukturerat, lättläst format med tydliga rubriker och Markdown-tabeller för ton och svarsbehov. Inkludera de korrekta källänkarna i din sammanfattning.

Svara på svenska.`;''


  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    });

    const data = await response.json();
    if (data.content && data.content.length > 0) {
      return data.content[0].text;
    }
    console.error('Claude svar:', JSON.stringify(data, null, 2));
    return 'Fel vid Claude-analys';
  } catch (e) {
    console.error('Claude API-fel:', e.message);
    return '';
  }
}

async function runAnalysis(searchTerms) {
  const today = new Date().toISOString().split('T')[0];
  
  const allArticles = loadArticles();
  const todayArticles = [];
  for (const source of sources) {
    console.log('Hamtar ' + source.name + '...');
    const items = await fetchFeed(source.url);
    
    for (const item of items) {
      const title = item.title || '';
      const content = item.contentSnippet || '';
      
      if (mentionsAny(title, content, searchTerms)) {
        const day = getDate(item.isoDate || item.pubDate);
        const matchedTerms = getMatchedTerms(title, content, searchTerms);
        
        todayArticles.push({
          date: day,
          source: source.name,
          title: title,
          description: content,
          link: item.link,
          matchedTerms: matchedTerms
        });
      }
    }
  }

  const existingLinks = new Set(allArticles.map(a => a.link));
  let newCount = 0;
  for (const article of todayArticles) {
    if (!existingLinks.has(article.link)) {
      allArticles.push(article);
      newCount++;
    }
  }

  saveArticles(allArticles);

  const todaysData = allArticles.filter(a => a.date === today);
  
  if (todaysData.length === 0) {
    return {
      articles: [],
      analysis: 'Inga artiklar hittades för idag.',
      newCount: newCount
    };
  }

  const analysis = await analyzeWithClaude(todaysData, searchTerms);
  
  return {
    articles: todaysData,
    analysis: analysis,
    newCount: newCount
  };
}

app.get('/api/sources', (req, res) => {
  res.json(sources);
});

app.post('/api/analyze', async (req, res) => {
  const { searchTerms } = req.body;
  
  if (!searchTerms || searchTerms.length === 0) {
    return res.status(400).json({ error: 'Sökord krävs' });
  }

  try {
    const result = await runAnalysis(searchTerms);
    res.json(result);
  } catch (e) {
    console.error('Analys-fel:', e.message);
    res.status(500).json({ error: 'Fel vid analys: ' + e.message });
  }
});


app.post('/api/export', (req, res) => {
  console.log('Export request received:', req.body);
  const { articles, analysis, searchTerms } = req.body;

  const articlesHtml = articles.map(a => 
    `<div class="border-l-4 border-blue-500 pl-4 py-2">
      <h3 class="font-bold text-gray-900">${a.title}</h3>
      <p class="text-sm text-gray-600 mt-1">${a.description}</p>
      <div class="flex justify-between mt-2">
        <span class="text-xs text-gray-500">Källa: ${a.source}</span>
        <a href="${a.link}" target="_blank" class="text-xs text-blue-600 hover:underline">Läs mer →</a>
      </div>
    </div>`
  ).join('');


  const html = `<!DOCTYPE html>
<html lang="sv">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Uddevalla Radar - Rapport</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-50">
  <div class="min-h-screen">
    <div class="bg-blue-600 text-white p-8">
      <h1 class="text-4xl font-bold">Uddevalla Radar</h1>
      <p class="text-blue-100 mt-2">Nyhetsbevakning och analys för Uddevalla kommun</p>
      <p class="text-blue-200 mt-4 text-sm">Rapport från ${new Date().toLocaleString('sv-SE')}</p>
    </div>

    <div class="max-w-4xl mx-auto p-8">
      <div class="bg-white rounded-lg shadow p-6 mb-8">
        <h2 class="text-2xl font-bold mb-4">Sökord</h2>
        <p class="text-gray-700">${searchTerms.join(', ')}</p>
      </div>

      <div class="bg-white rounded-lg shadow p-6 mb-8">
        <h2 class="text-2xl font-bold mb-4">${articles.length} artiklar från idag</h2>
        <div class="space-y-4">
          ${articles.map(a => `
            <div class="border-l-4 border-blue-500 pl-4 py-2">
              <h3 class="font-bold text-gray-900">${a.title}</h3>
              <p class="text-sm text-gray-600 mt-1">${a.description}</p>
              <div class="flex justify-between mt-2">
                <span class="text-xs text-gray-500">Källa: ${a.source}</span>
                <a href="${a.link}" target="_blank" class="text-xs text-blue-600 hover:underline">Läs mer →</a>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="bg-white rounded-lg shadow p-6">
        <h2 class="text-2xl font-bold mb-4">Claudes Analys</h2>
        <div class="whitespace-pre-wrap text-gray-700 leading-relaxed">${analysis}</div>
      </div>
    </div>
  </div>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="uddevalla-radar-' + new Date().toISOString().split('T')[0] + '.html"');
  res.send(html);
});
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log('Uddevalla Radar kör på http://localhost:' + PORT);
});