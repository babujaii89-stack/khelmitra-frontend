import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware'
import { buildFertilizerPlan, CROPS, currentSeason, recommendCrops, type FarmProfile, type FertilizerTask } from '@/lib/farm-data'

const GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'] as const

function normalizeLocation(value: string): string {
  return value
    .replace(/\b(district|dist\.?)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Strictly parses AGMARKNET DD/MM/YYYY or DD-MM-YYYY dates BEFORE falling back to ISO/Date.parse
 * so "05/11/2026" is never misread as May 11 instead of 5 November.
 */
function parseAgmarknetDate(value: string): number {
  const trimmed = value.trim()
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(trimmed)
  if (dmy) {
    const day = Number(dmy[1])
    const month = Number(dmy[2])
    const year = Number(dmy[3])
    const ts = new Date(year, month - 1, day).getTime()
    return Number.isFinite(ts) ? ts : 0
  }
  const iso = Date.parse(trimmed)
  return Number.isFinite(iso) ? iso : 0
}

async function callGeminiWithFallback(
  apiKey: string,
  payload: Record<string, unknown>,
  timeoutMs = 8000,
): Promise<{ ok: true; text: string } | { ok: false; status: number; detail: string }> {
  let lastStatus = 500
  let lastDetail = 'Unknown error'

  for (const model of GEMINI_MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(timeoutMs),
        },
      )

      if (!res.ok) {
        lastStatus = res.status
        const errBody = await res.text()
        console.warn(`[gemini] ${model} failed (${res.status}), trying next fallback...`, errBody)
        lastDetail = `HTTP ${res.status}`
        try {
          const parsedErr = JSON.parse(errBody) as { error?: { message?: string } }
          if (parsedErr.error?.message) lastDetail = parsedErr.error.message
        } catch {}
        continue
      }

      const json = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
      }
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
      if (text.trim()) {
        return { ok: true, text }
      }
      lastDetail = `Empty response from ${model}`
    } catch (error) {
      lastStatus = 504
      lastDetail = error instanceof Error ? error.message : String(error)
      console.warn(`[gemini] ${model} timed out or failed, trying next fallback...`, lastDetail)
    }
  }

  return { ok: false, status: lastStatus, detail: lastDetail }
}

/* ---------- Voice assistant ---------- */

export const askAssistant = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        question: z.string().trim().min(1).max(500),
        lang: z.enum(['en', 'ta']).default('en'),
        context: z.string().max(1500).default(''),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const apiKey = (process.env['GEMINI_AI_API'] || process.env['GEMINI_API_KEY'])
      ?.trim()
      .replace(/^["']|["']$/g, '')
    if (!apiKey) {
      console.error('[assistant] Missing GEMINI_API_KEY')
      return { answer: '', error: 'Assistant unavailable' }
    }

    const language = data.lang === 'ta' ? 'Tamil (in Tamil script)' : 'simple Indian English'
    const systemPrompt = `You are KhetMitra, a friendly voice assistant for Indian farmers inside a farm management app.
Always reply in ${language}. Your reply will be read aloud by text-to-speech, so:
- Keep it to 2-4 short sentences, practical and specific.
- No markdown, bullet points, emojis or symbols. Write numbers and units in words-friendly form (e.g. "2 grams per litre").
- For pesticides, give the common chemical name and dose, and remind about safety gear and the label.
- If the question is unrelated to farming or the app, answer briefly and politely steer back to farming.
The app has screens: Home, Crop advice, Leaf scan, Fertilizer schedule, Ledger, Subsidies, Disaster aid, Devices, Field GPS location. Suggest a relevant screen when helpful.
Farmer context: ${data.context}`

    const result = await callGeminiWithFallback(
      apiKey,
      {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: data.question }] }],
        generationConfig: {
          thinkingConfig: { thinkingLevel: 'low' },
        },
      },
      7000,
    )

    if (!result.ok) {
      console.error('[assistant] All Gemini models failed', result.status, result.detail)
      return { answer: '', error: 'Assistant unavailable' }
    }

    return { answer: result.text.trim() }
  })

/* ---------- Soil health card reader ---------- */

const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const
const MAX_FILE_BYTES = 15 * 1024 * 1024

type SoilValues = {
  ph: number | null
  organicCarbon: number | null
  nitrogen: number | null
  phosphorus: number | null
  potassium: number | null
}

export type SoilReportResult =
  | { ok: true; documentType: string; status: 'valid' | 'incomplete' | 'invalid'; values: SoilValues; confidence: number; message: string }
  | { ok: false; error: string }

const SOIL_PROMPT = `You are an expert document reader for Indian Soil Health Cards. Read the attached document and return ONLY valid JSON with this exact shape:
{
  "documentType": "soil_health_card" | "other" | "unreadable",
  "status": "valid" | "incomplete" | "invalid",
  "values": { "ph": number|null, "organicCarbon": number|null, "nitrogen": number|null, "phosphorus": number|null, "potassium": number|null },
  "units": { "nitrogen": string|null, "phosphorus": string|null, "potassium": string|null },
  "confidence": number,
  "message": string
}
Rules:
- Extract only values explicitly printed in the document. Do not infer, estimate, or invent missing values.
- pH is dimensionless; organicCarbon is percentage; N/P/K should be numeric values in kg/ha. If the card uses a different unit, convert only when the conversion is unambiguous; otherwise return null for that value and explain in message.
- Map available phosphorus and available potassium values to phosphorus and potassium. Do not confuse fertilizer recommendations with measured soil values.
- A recognizable Soil Health Card with all five values and plausible ranges (pH 0–14, organic carbon 0–100%, N/P/K non-negative) is valid.
- A recognizable Soil Health Card missing one or more required values is incomplete.
- A clearly unrelated document, fabricated-looking/non-soil document, or a report with impossible values is invalid.
- If the file cannot be read, documentType is unreadable and status is invalid.
- Keep confidence between 0 and 1. message should be a short, user-friendly explanation.
- Do not return markdown or any text outside the JSON.`

export const analyseSoilReport = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        filename: z.string().max(300),
        mimeType: z.enum(ALLOWED_TYPES),
        base64: z.string().min(1).max(Math.ceil((MAX_FILE_BYTES * 4) / 3) + 16),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<SoilReportResult> => {
    const apiKey = (process.env['GEMINI_AI_API'] || process.env['GEMINI_API_KEY'])
      ?.trim()
      .replace(/^["']|["']$/g, '')
    if (!apiKey) {
      return { ok: false, error: 'GEMINI_AI_API / GEMINI_API_KEY is not configured on the server.' }
    }

    const result = await callGeminiWithFallback(
      apiKey,
      {
        contents: [
          {
            role: 'user',
            parts: [
              { text: SOIL_PROMPT },
              { inlineData: { mimeType: data.mimeType, data: data.base64 } },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingLevel: 'low' },
        },
      },
      8500,
    )

    if (!result.ok) {
      if (result.status === 429) {
        return {
          ok: false,
          error: 'The report reader is busy. Please wait 30 seconds and try again. Your uploaded report was not lost.',
        }
      }
      return { ok: false, error: `Gemini error (${result.status}): ${result.detail}` }
    }

    const text = result.text

    let parsed: {
      documentType?: string
      status?: string
      values?: Partial<SoilValues>
      confidence?: number
      message?: string
    }
    try {
      parsed = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))
    } catch {
      return { ok: false, error: 'Could not parse Gemini response as JSON.' }
    }

    const keys: (keyof SoilValues)[] = ['ph', 'organicCarbon', 'nitrogen', 'phosphorus', 'potassium']
    const values = Object.fromEntries(
      keys.map((key) => {
        const value = parsed.values?.[key]
        return [key, typeof value === 'number' && Number.isFinite(value) ? value : null]
      }),
    ) as SoilValues
    const anyValue = keys.some((key) => values[key] !== null)
    const plausible =
      (values.ph === null || (values.ph >= 0 && values.ph <= 14)) &&
      (values.organicCarbon === null || (values.organicCarbon >= 0 && values.organicCarbon <= 100))
    const nonNegative = (['nitrogen', 'phosphorus', 'potassium'] as const).every((k) => values[k] === null || (values[k] as number) >= 0)
    const documentType =
      parsed.documentType === 'soil_health_card' ? 'soil_health_card' : parsed.documentType === 'unreadable' ? 'unreadable' : 'other'
    const complete = keys.every((key) => values[key] !== null)
    const status: 'valid' | 'incomplete' | 'invalid' =
      documentType !== 'soil_health_card' || !plausible || !nonNegative || parsed.status === 'invalid'
        ? 'invalid'
        : complete
          ? 'valid'
          : anyValue
            ? 'incomplete'
            : 'invalid'

    return {
      ok: true,
      documentType,
      status,
      values,
      confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0,
      message:
        typeof parsed.message === 'string'
          ? parsed.message.slice(0, 300)
          : status === 'valid'
            ? 'Soil report verified. Values have been filled in.'
            : status === 'incomplete'
              ? 'Some values were found. Please enter the missing values manually.'
              : 'This does not appear to be a readable Soil Health Card.',
    }
  })

/* ---------- GPS ---------- */

const coords = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
})

export const recordGps = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    coords.extend({ accuracy: z.number().finite().nonnegative().optional(), timestamp: z.number().optional() }).parse(input),
  )
  .handler(async ({ data }) => ({
    success: true,
    data: { ...data, accuracy: data.accuracy ?? null, timestamp: data.timestamp ?? Date.now() },
  }))

export const reverseGeocode = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => coords.parse(input))
  .handler(async ({ data }) => {
    try {
      const url = new URL('https://nominatim.openstreetmap.org/reverse')
      url.searchParams.set('format', 'jsonv2')
      url.searchParams.set('lat', String(data.latitude))
      url.searchParams.set('lon', String(data.longitude))
      url.searchParams.set('zoom', '10')
      url.searchParams.set('addressdetails', '1')
      const response = await fetch(url, {
        headers: { 'User-Agent': 'KhetMitra/1.0 (farm location lookup)', 'Accept-Language': 'en' },
        signal: AbortSignal.timeout(10000),
      })
      if (!response.ok) return { error: 'The location service could not identify this area.', village: '', district: '', state: '' }
      const json = (await response.json()) as { address?: Record<string, string>; display_name?: string }
      const a = json.address ?? {}
      const pick = (...keys: string[]) => keys.map((k) => a[k]).find((v) => typeof v === 'string' && v) ?? ''
      const village = pick('village', 'hamlet', 'locality', 'town', 'city', 'municipality', 'suburb', 'neighbourhood')
      const district = normalizeLocation(pick('state_district', 'district', 'county'))
      const state = normalizeLocation(pick('state'))
      return { village, district, state, displayName: json.display_name ?? '', error: '' }
    } catch {
      return {
        error: 'Unable to look up this location right now. Please enter the village and district manually.',
        village: '',
        district: '',
        state: '',
      }
    }
  })

/* ---------- Live mandi prices (data.gov.in / AGMARKNET) ---------- */

const mandiInput = z.object({
  district: z.string().trim().min(2).max(100),
  state: z.string().trim().min(2).max(100).optional(),
  crops: z.array(z.string().trim().min(1).max(60)).min(1).max(10),
})

export type MandiQuote = {
  crop: string
  price: number | null
  market: string | null
  arrivalDate: string | null
  source: string
  note?: string
}

export const getMandiPrices = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => mandiInput.parse(input))
  .handler(async ({ data }): Promise<{ quotes: MandiQuote[]; live: boolean; message: string }> => {
    const apiKey = process.env['DATA_GOV_IN_API_KEY']?.trim()
    if (!apiKey) {
      return {
        quotes: data.crops.map((crop) => ({ crop, price: null, market: null, arrivalDate: null, source: 'data.gov.in' })),
        live: false,
        message: 'Live mandi prices need DATA_GOV_IN_API_KEY in the server environment. Crop fit is still calculated from your farm profile.',
      }
    }

    const state = normalizeLocation(data.state || process.env['MANDI_STATE'] || 'Maharashtra')
    const district = normalizeLocation(data.district)
    const resource = process.env['DATA_GOV_IN_MANDI_RESOURCE_ID'] || '9ef84268-d588-465a-a308-a864a43d0070'

    const quotes = await Promise.all(
      data.crops.map(async (crop): Promise<MandiQuote> => {
        try {
          const allRecords: Array<{ price: number; market: string; arrivalDate: string }> = []
          const pageSize = 500
          const maxPages = 6

          for (let page = 0; page < maxPages; page++) {
            const url = new URL(`https://api.data.gov.in/resource/${resource}`)
            url.searchParams.set('api-key', apiKey)
            url.searchParams.set('format', 'json')
            url.searchParams.set('limit', String(pageSize))
            url.searchParams.set('offset', String(page * pageSize))
            url.searchParams.set('filters[state]', state)
            url.searchParams.set('filters[district]', district)
            url.searchParams.set('filters[commodity]', crop)

            const response = await fetch(url, {
              signal: AbortSignal.timeout(9000),
              headers: { Accept: 'application/json' },
            })

            if (!response.ok) {
              if (page === 0) {
                return {
                  crop,
                  price: null,
                  market: null,
                  arrivalDate: null,
                  source: 'data.gov.in',
                  note: `Mandi service returned ${response.status}`,
                }
              }
              break
            }

            const body = (await response.json()) as {
              total?: number
              records?: Array<Record<string, unknown>>
            }
            const rawRecords = body.records ?? []

            for (const r of rawRecords) {
              const price = Number(r.modal_price ?? r.modalprice ?? r.modalPrice)
              if (Number.isFinite(price) && price > 0) {
                allRecords.push({
                  price,
                  market: String(r.market ?? r.market_name ?? '').trim(),
                  arrivalDate: String(r.arrival_date ?? r.arrivalDate ?? '').trim(),
                })
              }
            }

            if (rawRecords.length < pageSize || (typeof body.total === 'number' && (page + 1) * pageSize >= body.total)) {
              break
            }
          }

          if (allRecords.length === 0) {
            return {
              crop,
              price: null,
              market: null,
              arrivalDate: null,
              source: 'AGMARKNET via data.gov.in',
              note: `No matching district-market quote was returned for ${crop} in ${district}, ${state}.`,
            }
          }

          allRecords.sort((a, b) => parseAgmarknetDate(b.arrivalDate) - parseAgmarknetDate(a.arrivalDate))

          const latestTs = parseAgmarknetDate(allRecords[0]!.arrivalDate)
          const latestDayRecords = allRecords.filter((r) => parseAgmarknetDate(r.arrivalDate) === latestTs)

          const avgPrice = Math.round(
            latestDayRecords.reduce((sum, r) => sum + r.price, 0) / latestDayRecords.length,
          )
          const uniqueMarkets = Array.from(new Set(latestDayRecords.map((r) => r.market).filter(Boolean)))
          const marketLabel =
            uniqueMarkets.length > 1
              ? `${uniqueMarkets[0]} (+${uniqueMarkets.length - 1} mandis)`
              : uniqueMarkets[0] || null

          return {
            crop,
            price: avgPrice,
            market: marketLabel,
            arrivalDate: latestDayRecords[0]!.arrivalDate || null,
            source: 'AGMARKNET via data.gov.in',
          }
        } catch {
          return {
            crop,
            price: null,
            market: null,
            arrivalDate: null,
            source: 'data.gov.in',
            note: 'Mandi service unavailable; retry later.',
          }
        }
      }),
    )

    return {
      quotes,
      live: quotes.some((q) => q.price !== null),
      message: 'Prices are the latest matching market quotes returned by AGMARKNET; availability varies by district and commodity.',
    }
  })

/* ---------- Account-backed crop advice and crop validation ---------- */

export const getCropAdvice = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({}).parse(input))
  .handler(async ({ context }) => {
    const { data: row, error } = await context.supabase
      .from('profiles')
      .select('farm_profile, onboarded')
      .eq('id', context.userId)
      .maybeSingle()
    if (error) throw new Error(`Could not load your saved farm profile: ${error.message}`)
    if (!row?.farm_profile || !row.onboarded) throw new Error('Complete your farm profile before requesting crop advice.')
    const profile = row.farm_profile as unknown as FarmProfile
    const season = currentSeason()
    return {
      season,
      recommendations: recommendCrops(profile, season),
      profileSummary: {
        district: profile.district,
        state: profile.state ?? null,
        soil: profile.soil,
        previousCrops: profile.previousCrops,
      },
    }
  })

/* ---------- Account-backed fertilizer schedule ---------- */

export const getFertilizerPlan = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({}).parse(input))
  .handler(async ({ context }) => {
    const { data: row, error } = await context.supabase
      .from('profiles')
      .select('farm_profile, active_crop_id, tasks')
      .eq('id', context.userId)
      .maybeSingle()
    if (error) throw new Error(`Could not load your saved crop: ${error.message}`)
    if (!row) throw new Error('Farm profile not found.')
    const profile = (row.farm_profile ?? {}) as unknown as FarmProfile
    const crop = CROPS.find((item) => item.id === row.active_crop_id) ?? CROPS[0]!
    const startedAt = profile.cropStartedAt ?? new Date().toISOString()
    const storedTasks = Array.isArray(row.tasks) ? row.tasks : []
    const completed = new Map<string, FertilizerTask['done']>()
    for (const value of storedTasks) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const item = value as Record<string, unknown>
        if (item.done && typeof item.done === 'object') {
          completed.set(String(item.id), item.done as FertilizerTask['done'])
        }
      }
    }
    const tasks = buildFertilizerPlan(crop, profile.soil ?? {
      ph: 6.5, organicCarbon: 0.5, nitrogen: 280, phosphorus: 22, potassium: 140,
    }).map((task, index) => ({
      ...task,
      id: `${crop.id}-${index}`,
      ...(completed.has(`${crop.id}-${index}`) ? { done: completed.get(`${crop.id}-${index}`) } : {}),
    }))
    return { cropId: crop.id, cropName: crop.name, durationDays: crop.durationDays, startedAt, tasks }
  })
