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
    why: z.string(),
    when: z.string(),
    cost: z.string(),
  })),
  day_plan: z.array(z.object({ time: z.string(), activity: z.string() })),
  tips: z.array(z.string()),
});

const SYSTEM = `You plan meetups for groups of friends who have just found a fair place to meet (each person travels a similar or reasonable time).
You get the meeting place, who is coming and how long each trip takes, the group's preferences, and a list of real places near the meeting point taken from OpenStreetMap.

Rules:
- Prefer places from the provided list. When you use one, copy its name exactly into place_name and set from_list to true.
- You may suggest well-known things not in the list (set from_list to false), but never invent a specific business that you are not confident exists. Generic ideas ("a Korean BBQ place around the station") are fine.
- Do not state exact opening hours, ticket prices or event dates as facts. Give rough cost levels like "$", "$$" or "about 15,000 KRW per person", and tell people to check details.
- Fit the season, budget, vibe and notes. If someone travels much longer than the others, consider a later start or an easy first stop.
- Give 5 to 7 picks, a day plan of 4 to 6 steps that starts when the last person arrives, and 2 to 4 practical tips.
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
  const { place, people = [], prefs = {}, pois = [], tier } = input;
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
    `Nearby places from OpenStreetMap (${pois.length}):`,
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
