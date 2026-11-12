export type Terrain = 'plains' | 'hilly' | 'plateau'
export type Season = 'Kharif' | 'Rabi' | 'Zaid'

export type SoilReport = {
  ph: number
  nitrogen: number
  phosphorus: number
  potassium: number
  organicCarbon: number
}

export type FarmProfile = {
  /** Crop-cycle start date persisted inside profiles.farm_profile (no schema change). */
  cropStartedAt?: string
  farmerName: string
  village: string
  district: string
  state?: string
  terrain: Terrain
  elevation: number
  acres: number
  soil: SoilReport
  previousCrops: string[]
  hasPolyhouse: boolean
}

export type CropInfo = {
  id: string
  name: string
  seasons: Season[]
  terrains: Terrain[]
  phRange: [number, number]
  nNeed: 'low' | 'medium' | 'high'
  durationDays: number
  yieldPerAcre: number
  costPerAcre: number
  basePrice: number
  volatility: number
  family: string
}

export const CROPS: CropInfo[] = [
  { id: 'tomato', name: 'Tomato', seasons: ['Rabi', 'Zaid'], terrains: ['plains', 'hilly', 'plateau'], phRange: [6.0, 7.0], nNeed: 'high', durationDays: 120, yieldPerAcre: 100, costPerAcre: 62000, basePrice: 1500, volatility: 0.45, family: 'Solanaceae' },
  { id: 'onion', name: 'Onion', seasons: ['Rabi', 'Kharif'], terrains: ['plains', 'plateau'], phRange: [6.0, 7.5], nNeed: 'medium', durationDays: 130, yieldPerAcre: 90, costPerAcre: 55000, basePrice: 1800, volatility: 0.5, family: 'Amaryllidaceae' },
  { id: 'potato', name: 'Potato', seasons: ['Rabi'], terrains: ['plains', 'hilly'], phRange: [5.2, 6.5], nNeed: 'high', durationDays: 100, yieldPerAcre: 110, costPerAcre: 58000, basePrice: 1200, volatility: 0.3, family: 'Solanaceae' },
  { id: 'wheat', name: 'Wheat', seasons: ['Rabi'], terrains: ['plains', 'plateau'], phRange: [6.0, 7.5], nNeed: 'medium', durationDays: 140, yieldPerAcre: 20, costPerAcre: 24000, basePrice: 2350, volatility: 0.08, family: 'Poaceae' },
  { id: 'mustard', name: 'Mustard', seasons: ['Rabi'], terrains: ['plains', 'plateau'], phRange: [6.0, 8.0], nNeed: 'low', durationDays: 120, yieldPerAcre: 8, costPerAcre: 16000, basePrice: 5650, volatility: 0.12, family: 'Brassicaceae' },
  { id: 'ginger', name: 'Ginger', seasons: ['Kharif'], terrains: ['hilly'], phRange: [5.5, 6.5], nNeed: 'medium', durationDays: 240, yieldPerAcre: 60, costPerAcre: 90000, basePrice: 4200, volatility: 0.4, family: 'Zingiberaceae' },
  { id: 'capsicum', name: 'Capsicum', seasons: ['Rabi', 'Zaid'], terrains: ['hilly', 'plains'], phRange: [6.0, 7.0], nNeed: 'high', durationDays: 110, yieldPerAcre: 80, costPerAcre: 85000, basePrice: 2800, volatility: 0.35, family: 'Solanaceae' },
  { id: 'cabbage', name: 'Cabbage', seasons: ['Rabi'], terrains: ['hilly', 'plains'], phRange: [6.0, 6.8], nNeed: 'high', durationDays: 90, yieldPerAcre: 120, costPerAcre: 45000, basePrice: 900, volatility: 0.38, family: 'Brassicaceae' },
  { id: 'soybean', name: 'Soybean', seasons: ['Kharif'], terrains: ['plateau', 'plains'], phRange: [6.0, 7.5], nNeed: 'low', durationDays: 100, yieldPerAcre: 10, costPerAcre: 20000, basePrice: 4600, volatility: 0.1, family: 'Fabaceae' },
  { id: 'paddy', name: 'Paddy', seasons: ['Kharif'], terrains: ['plains', 'hilly'], phRange: [5.0, 7.0], nNeed: 'high', durationDays: 130, yieldPerAcre: 24, costPerAcre: 28000, basePrice: 2300, volatility: 0.06, family: 'Poaceae' },
]

export function currentSeason(date = new Date()): Season {
  const m = date.getMonth() + 1
  if (m >= 6 && m <= 9) return 'Kharif'
  if (m >= 10 || m <= 2) return 'Rabi'
  return 'Zaid'
}

export type Recommendation = {
  crop: CropInfo
  score: number
  reasons: string[]
  warnings: string[]
}

const levelOf = (v: number, low: number, high: number) => (v < low ? 'low' : v > high ? 'high' : 'medium')

export function recommendCrops(profile: FarmProfile, season: Season): Recommendation[] {
  const nLevel = levelOf(profile.soil.nitrogen, 280, 560)
  return CROPS.map((crop) => {
    let score = 40
    const reasons: string[] = []
    const warnings: string[] = []
    const [lo, hi] = crop.phRange
    if (profile.soil.ph >= lo && profile.soil.ph <= hi) {
      score += 22
      reasons.push(`Soil pH ${profile.soil.ph} is within ideal ${lo}–${hi}`)
    } else {
      const off = Math.min(Math.abs(profile.soil.ph - lo), Math.abs(profile.soil.ph - hi))
      score -= Math.round(off * 15)
      warnings.push(`pH ${profile.soil.ph} outside ideal ${lo}–${hi}`)
    }
    if (crop.terrains.includes(profile.terrain)) {
      score += 15
      reasons.push(`Suited to ${profile.terrain} terrain`)
    } else {
      score -= 15
      warnings.push(`Not ideal for ${profile.terrain} terrain`)
    }
    if (crop.seasons.includes(season)) {
      score += 18
      reasons.push(`${season} season crop`)
    } else {
      score -= 25
      warnings.push(`Off-season for ${season}`)
    }
    if (crop.nNeed === nLevel || (crop.nNeed === 'low' && nLevel !== 'low')) {
      score += 6
      reasons.push(`Nitrogen level (${nLevel}) matches demand`)
    } else if (crop.nNeed === 'high' && nLevel === 'low') {
      score -= 6
      warnings.push('Needs extra nitrogen top-dressing')
    }
    if (profile.soil.phosphorus < 22) {
      score -= 4
      warnings.push('Low soil phosphorus — plan a soil-test-based basal phosphorus dose')
    } else {
      reasons.push('Soil phosphorus is not in the low range')
    }
    if (profile.soil.potassium < 140) {
      score -= 4
      warnings.push('Low soil potassium — plan a soil-test-based potash dose')
    } else {
      reasons.push('Soil potassium is not in the low range')
    }
    if (profile.soil.organicCarbon < 0.5) {
      score -= 3
      warnings.push('Low organic carbon — improve soil organic matter')
    } else {
      reasons.push('Soil organic carbon is adequate for the screening rule')
    }
    const lastCrop = CROPS.find((c) => c.name === profile.previousCrops[0])
    if (lastCrop && lastCrop.family === crop.family) {
      score -= 12
      warnings.push(`Same family as last crop (${lastCrop.name}) — rotation risk`)
    } else if (lastCrop?.family === 'Fabaceae') {
      score += 5
      reasons.push('Benefits from legume residue nitrogen')
    }
    return { crop, score: Math.max(5, Math.min(98, score)), reasons, warnings }
  }).sort((a, b) => b.score - a.score)
}

function seeded(seed: number) {
  let s = seed
  return () => {
    s = (s * 9301 + 49297) % 233280
    return s / 233280
  }
}

export type PricePoint = { month: string; price: number; forecast?: number }

export function priceHistory(crop: CropInfo): PricePoint[] {
  const rand = seeded(crop.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0))
  const now = new Date()
  const points: PricePoint[] = []
  for (let i = 23; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const seasonal = Math.sin(((d.getMonth() + crop.id.length) / 12) * Math.PI * 2) * crop.volatility * 0.6
    const noise = (rand() - 0.5) * crop.volatility * 0.5
    const trend = (23 - i) * 0.004
    points.push({
      month: d.toLocaleString('en', { month: 'short', year: '2-digit' }),
      price: Math.round(crop.basePrice * (1 + seasonal + noise + trend)),
    })
  }
  const lastPoint = points[points.length - 1]!
  const last = lastPoint.price
  lastPoint.forecast = last
  for (let i = 1; i <= Math.ceil(crop.durationDays / 30); i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    const seasonal = Math.sin(((d.getMonth() + crop.id.length) / 12) * Math.PI * 2) * crop.volatility * 0.6
    points.push({
      month: d.toLocaleString('en', { month: 'short', year: '2-digit' }),
      price: NaN,
      forecast: Math.round(crop.basePrice * (1 + seasonal + 0.1)),
    })
  }
  return points
}

export type MarketAnalysis = {
  current: number
  avg2y: number
  min: number
  max: number
  forecastHarvest: number
  revenuePerAcre: number
  profitPerAcre: number
  margin: number
  risk: 'Low' | 'Moderate' | 'High'
  riskScore: number
  verdict: string
}

export function analyzeMarket(crop: CropInfo, acres: number): MarketAnalysis & { series: PricePoint[] } {
  const series = priceHistory(crop)
  const hist = series.filter((p) => !Number.isNaN(p.price)).map((p) => p.price)
  const current = hist[hist.length - 1] ?? 0
  const avg2y = Math.round(hist.reduce((a, b) => a + b, 0) / hist.length)
  const min = Math.min(...hist)
  const max = Math.max(...hist)
  const forecastHarvest = series[series.length - 1]?.forecast ?? current
  const revenuePerAcre = forecastHarvest * crop.yieldPerAcre
  const profitPerAcre = revenuePerAcre - crop.costPerAcre
  const margin = Math.round((profitPerAcre / revenuePerAcre) * 100)
  const spread = (max - min) / avg2y
  const riskScore = Math.min(100, Math.round(spread * 70 + (margin < 15 ? 25 : 0)))
  const risk = riskScore > 60 ? 'High' : riskScore > 32 ? 'Moderate' : 'Low'
  const verdict =
    profitPerAcre <= 0
      ? `Forecast shows a loss of ₹${Math.abs(Math.round(profitPerAcre * acres)).toLocaleString('en-IN')} on ${acres} acres. Consider an alternative.`
      : risk === 'High'
        ? 'Profitable on average but prices swing sharply. Stagger sowing or secure a buyer contract.'
        : 'Healthy margin with manageable price swings. Good choice for this season.'
  return { series, current, avg2y, min, max, forecastHarvest, revenuePerAcre, profitPerAcre, margin, risk, riskScore, verdict }
}

export type FertilizerTask = {
  id: string
  day: number
  product: string
  type: 'Nitrogen' | 'Phosphate' | 'Potash' | 'Micronutrient' | 'Fungicide' | 'Organic'
  dosePerAcre: number
  unit: 'kg' | 'L'
  method: string
  done?: { date: string; actualDose: number }
}

export const FERTILIZER_TEMPLATE: Omit<FertilizerTask, 'id' | 'done'>[] = [
  { day: 0, product: 'Well-decomposed farmyard manure', type: 'Organic', dosePerAcre: 4000, unit: 'kg', method: 'Incorporate into the soil 10–15 days before planting; use mature, well-decomposed manure.' },
  { day: 0, product: 'Balanced basal NPK (soil-test based)', type: 'Phosphate', dosePerAcre: 40, unit: 'kg', method: 'Apply the locally recommended basal dose near the root zone; adjust to soil-test recommendations.' },
  { day: 20, product: 'Urea (nitrogen top dressing)', type: 'Nitrogen', dosePerAcre: 20, unit: 'kg', method: 'Apply only if crop growth and soil-test nitrogen indicate need; irrigate after application.' },
  { day: 40, product: 'Potassium source (MOP/SOP)', type: 'Potash', dosePerAcre: 15, unit: 'kg', method: 'Apply as a split dose based on crop stage and soil-test potassium.' },
  { day: 55, product: 'Water-soluble micronutrient mix', type: 'Micronutrient', dosePerAcre: 1, unit: 'kg', method: 'Use only where deficiency is confirmed; follow the product label for dilution and crop safety.' },
]

/** Conservative stage-based plan. Final rates must be confirmed against local soil-test and extension recommendations. */
export function buildFertilizerPlan(crop: CropInfo, soil: SoilReport): Omit<FertilizerTask, 'id' | 'done'>[] {
  const lowN = soil.nitrogen < 280
  const lowP = soil.phosphorus < 22
  const lowK = soil.potassium < 140
  const days = crop.durationDays
  const nRate = crop.nNeed === 'high' ? (lowN ? 35 : 22) : crop.nNeed === 'medium' ? (lowN ? 25 : 15) : (lowN ? 15 : 8)
  const plan: Omit<FertilizerTask, 'id' | 'done'>[] = [
    { day: 0, product: 'Well-decomposed farmyard manure', type: 'Organic', dosePerAcre: 4000, unit: 'kg', method: 'Incorporate into soil before planting; use mature, well-decomposed manure.' },
    { day: 0, product: lowP ? 'DAP (soil-test adjusted basal phosphorus)' : 'Balanced basal NPK (soil-test based)', type: 'Phosphate', dosePerAcre: lowP ? 45 : 35, unit: 'kg', method: 'Basal placement at planting; confirm exact nutrient requirement with local soil-test guidance.' },
    { day: Math.max(14, Math.round(days * 0.2)), product: 'Urea (first nitrogen split)', type: 'Nitrogen', dosePerAcre: +(nRate * 0.55).toFixed(1), unit: 'kg', method: 'Side-dress near the root zone; irrigate after application.' },
    { day: Math.max(28, Math.round(days * 0.4)), product: 'Urea (second nitrogen split)', type: 'Nitrogen', dosePerAcre: +(nRate * 0.45).toFixed(1), unit: 'kg', method: 'Apply only if crop condition supports it; avoid application before heavy rain.' },
    { day: Math.round(days * 0.55), product: lowK ? 'MOP (potash; soil-test adjusted)' : 'MOP/SOP (potash split)', type: 'Potash', dosePerAcre: lowK ? 22 : 12, unit: 'kg', method: 'Apply as a split dose according to soil-test potassium and crop stage.' },
  ]
  if (['tomato', 'potato', 'onion', 'capsicum', 'cabbage'].includes(crop.id)) {
    plan.push({ day: Math.round(days * 0.65), product: 'Micronutrient mix (only if deficiency confirmed)', type: 'Micronutrient', dosePerAcre: 1, unit: 'kg', method: 'Apply only after confirming deficiency; follow label dilution and local extension advice.' })
  }
  plan.push({ day: Math.round(days * 0.82), product: 'Potassium finishing dose (only if crop/soil test requires)', type: 'Potash', dosePerAcre: 8, unit: 'kg', method: 'For fruit, tuber or bulb filling only where recommended; avoid late application without local agronomist guidance.' })
  return plan.filter((task) => task.day < days).sort((a, b) => a.day - b.day)
}

export type ExpenseCategory = 'Seeds' | 'Fertilizer' | 'Pesticide' | 'Labour' | 'Irrigation' | 'Machinery' | 'Other'

export type LedgerEntry = {
  id: string
  kind: 'expense' | 'income'
  category: ExpenseCategory | 'Sale'
  label: string
  amount: number
  date: string
}

export type Scheme = {
  id: string
  name: string
  body: string
  benefit: string
  deadline: string
  tag: 'Subsidy' | 'Grant' | 'Credit' | 'Insurance' | 'Relief'
  eligibility: string
}

export const SUBSIDIES: Scheme[] = [
  { id: 's1', name: 'PM-KISAN Income Support', body: 'Ministry of Agriculture', benefit: '₹6,000 / year in 3 instalments', deadline: 'Rolling', tag: 'Grant', eligibility: 'All landholding farmer families' },
  { id: 's2', name: 'Micro Irrigation (PMKSY)', body: 'Per Drop More Crop', benefit: 'Up to 55% subsidy on drip/sprinkler', deadline: '30 Nov', tag: 'Subsidy', eligibility: 'Small & marginal farmers' },
  { id: 's3', name: 'Polyhouse & Shade Net (MIDH)', body: 'National Horticulture Board', benefit: '50% of cost, up to 4,000 m²', deadline: '15 Dec', tag: 'Subsidy', eligibility: 'Horticulture growers' },
  { id: 's4', name: 'Soil Health Card', body: 'Dept. of Agriculture', benefit: 'Free soil testing every 2 years', deadline: 'Rolling', tag: 'Grant', eligibility: 'All farmers' },
  { id: 's5', name: 'Kisan Credit Card', body: 'NABARD / Banks', benefit: 'Crop loan at 4% effective interest', deadline: 'Rolling', tag: 'Credit', eligibility: 'Farmers, tenant farmers, SHGs' },
]

export const RELIEF_SCHEMES: Scheme[] = [
  { id: 'r1', name: 'PM Fasal Bima Yojana (PMFBY)', body: 'Crop insurance', benefit: 'Covers yield loss from natural calamities', deadline: 'Report within 72 hrs', tag: 'Insurance', eligibility: 'Insured crops, notified areas' },
  { id: 'r2', name: 'State Disaster Response Fund', body: 'District Collector office', benefit: 'Input subsidy for >33% crop loss', deadline: 'Within 30 days', tag: 'Relief', eligibility: 'Affected farmers in declared areas' },
  { id: 'r3', name: 'Restructured Weather Based Insurance', body: 'RWBCIS', benefit: 'Payout triggered by weather data', deadline: 'Automatic', tag: 'Insurance', eligibility: 'Enrolled horticulture crops' },
  { id: 'r4', name: 'KCC Loan Restructuring', body: 'RBI guidelines', benefit: 'Loan rescheduling & interest relief', deadline: 'Within 90 days', tag: 'Credit', eligibility: 'KCC holders with >33% loss' },
]

export const DEFAULT_PROFILE: FarmProfile = {
  farmerName: 'Ramesh Patil',
  village: 'Shirol',
  district: 'Kolhapur',
  state: 'Maharashtra',
  terrain: 'plains',
  elevation: 548,
  acres: 3.5,
  soil: { ph: 6.6, nitrogen: 310, phosphorus: 22, potassium: 240, organicCarbon: 0.62 },
  previousCrops: ['Soybean', 'Wheat'],
  hasPolyhouse: true,
}

export const inr = (n: number) =>
  `₹${Math.round(n).toLocaleString('en-IN')}`

export function addDays(date: Date, days: number) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

export const fmtDate = (d: Date | string) =>
  new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
