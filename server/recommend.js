// POST /api/recommend — asks Claude what the group could do at the meeting place.
// Runs inside the Vite dev/preview server so the API key never reaches the browser.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';

const MODEL = 'claude-opus-5-5';

const Recommendations = z.object({
  headline: z.string(),
  summary: z.string(),
  picks: z.array(z.object({
    title: z.string(),
    category: z.enum(['food', 'drinks', 'cafe', 'sights', 'culture', 'nature', 'shopping', 'activity', 'nightlife', 'event', 'stay']),
    place_name: z.string(),
    from_list: z.boolean(),
    badge: z.string(),
    why: z.string(),
    when: z.string(),
    cost: z.string(),
  })),
  day_plan: z.array(z.object({ time: z.string(), activity: z.string() })),
  tips: z.array(z.string()),
});

const SYSTEM = `You are a well-traveled local friend planning a meetup for a group who just found a fair place to meet (each person travels a similar time).
Recommend what people who know the place actually recommend: the famous must-sees and the legendary local spots, not random nearby businesses.
For example, in Paris: the Louvre, Musée d'Orsay, Jardin du Luxembourg, a classic bistro. In Myeongdong: Myeongdong Kyoja (Michelin Bib Gourmand kalguksu), the street-food stalls in the evening, Namsan Seoul Tower. In Vienna: St. Stephen's Cathedral, Schönbrunn, Café Central or Café Sperl, Figlmüller for schnitzel, the Naschmarkt.

You get the meeting place, who is coming and how long each trip takes, the group's preferences, a list of FAMOUS places near the meeting point (real places with a Wikipedia article, biggest first) and a list of other nearby places from OpenStreetMap.

Rules:
- Use your own knowledge of the area first: landmarks, museums, viewpoints, parks, signature food (the dish the area is known for and the famous place to eat it), Michelin-listed or long-standing institutions, well-loved markets, cafés and night spots.
- Only name specific businesses you are confident exist and are well known. Put the real, searchable name in place_name (with the local-script name in brackets if it differs, e.g. "Myeongdong Kyoja (명동교자)"). Set from_list to true only when it is in one of the provided lists, copying that name exactly.
- Stay near the meeting point: walking distance or a short ride for a spot inside a city, the city and its easy day trips otherwise.
- Use "badge" for a short, true reason it is famous ("Michelin Bib Gourmand", "UNESCO World Heritage", "Since 1876", "Locals' favorite", "Signature dish: kalguksu"), or an empty string.
- Do not state exact opening hours, ticket prices or event dates as facts. Give rough cost levels like "Free", "$", "$$" or "about 15,000 KRW per person".
- Fit the season, budget, vibe and notes. If someone travels much longer than the others, start easy.
- Give 6 to 8 picks, mixing must-see sights with famous food, a day plan of 4 to 6 steps that starts when the last person arrives, and 2 to 4 practical tips.
- Write every text field in the requested language. Keep each "why" to one or two sentences.`;

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

let client;

export async function recommendHandler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  let input;
  try { input = await readJson(req); } catch { return send(res, 400, { error: 'Bad JSON' }); }

  client ??= new Anthropic();
  const { place, people = [], prefs = {}, pois = [], famous = [], tier } = input;
  const prompt = [
    `Meeting place: ${place?.name}${place?.country ? ', ' + place.country : ''} (${tier === 'city' ? 'a spot inside one city' : tier === 'region' ? 'a city between their home cities' : 'a city the friends travel to from different countries'}).`,
    `Coordinates: ${place?.lat?.toFixed?.(4)}, ${place?.lng?.toFixed?.(4)}`,
    `Group (${people.length}): ${people.map((p) => `${p.name} – ${p.minutes} min by ${p.how}`).join('; ')}`,
    `Season / date: ${prefs.season || 'any'}`,
    `Budget: ${prefs.budget || 'any'}`,
    `Vibe: ${(prefs.vibes || []).join(', ') || 'open to anything'}`,
    `Notes from the group: ${prefs.notes || 'none'}`,
    `Answer language: ${prefs.lang || 'English'}`,
    '',
    `Famous places nearby (${famous.length}):`,
    ...famous.slice(0, 40).map((p) => `- ${p.name}${p.nameEn && p.nameEn !== p.name ? ` (${p.nameEn})` : ''} [${p.kind}]${p.desc ? ' – ' + p.desc : ''}`),
    '',
    `Other places nearby from OpenStreetMap (${pois.length}):`,
    ...pois.slice(0, 80).map((p) => `- ${p.name}${p.nameEn && p.nameEn !== p.name ? ` (${p.nameEn})` : ''} [${p.kind}${p.cuisine ? ', ' + p.cuisine : ''}]`),
  ].join('\n');

  try {
    const msg = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: betaZodOutputFormat(Recommendations) },
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    });
    if (msg.stop_reason === 'refusal') return send(res, 422, { error: 'The model declined this request.' });
    if (!msg.parsed_output) return send(res, 502, { error: 'Could not read the model answer.' });
    send(res, 200, { model: msg.model, ...msg.parsed_output });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || /api[_ ]?key|credentials/i.test(err.message)) {
      return send(res, 503, { error: 'no-key', message: 'Set ANTHROPIC_API_KEY in .env to get AI ideas.' });
    }
    if (err instanceof Anthropic.RateLimitError) return send(res, 429, { error: 'Rate limited, try again in a moment.' });
    if (err instanceof Anthropic.APIError) return send(res, 502, { error: `Claude API error ${err.status ?? ''}: ${err.message}` });
    return send(res, 500, { error: err.message });
  }
}
