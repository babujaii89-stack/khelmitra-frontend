'use client'

import { Area, AreaChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, ShieldCheck, TrendingDown, TrendingUp } from 'lucide-react'
import { analyzeMarket, inr, type CropInfo } from '@/lib/farm-data'
import { Card, Meter, Pill } from './ui'

export function MarketReport({ crop, acres, livePrice }: { crop: CropInfo; acres: number; livePrice?: number }) {
  const a = analyzeMarket(crop, acres)
  const current = livePrice ?? a.current
  const forecastHarvest = livePrice ? Math.round(livePrice * (a.current > 0 ? a.forecastHarvest / a.current : 1)) : a.forecastHarvest
  const revenuePerAcre = forecastHarvest * crop.yieldPerAcre
  const profitPerAcre = revenuePerAcre - crop.costPerAcre
  const margin = revenuePerAcre > 0 ? Math.round((profitPerAcre / revenuePerAcre) * 100) : 0
  const up = forecastHarvest >= current
  const riskTone = a.risk === 'High' ? 'danger' : a.risk === 'Moderate' ? 'accent' : 'success'
  const verdict = profitPerAcre <= 0
    ? 'The indicative harvest-price projection is below the estimated cultivation cost. Review costs and consider another crop.'
    : a.risk === 'High'
      ? 'The model indicates high price variability. Confirm a buyer or plan staggered harvests.'
      : 'The indicative margin is positive. Recheck the market quote and input costs before planting.'

  return (
    <div className="flex flex-col gap-3">
      <Card className="p-3">
        <div className="flex items-center justify-between px-1">
          <div>
            <p className="text-xs text-muted-foreground">{livePrice ? "Latest mandi modal price" : "Indicative model price"} · ₹/quintal</p>
            <p className="text-lg font-bold">{inr(current)}</p>
          </div>
          <Pill tone={up ? 'success' : 'danger'}>
            {up ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
            {up ? '+' : ''}
            {Math.round(((forecastHarvest - current) / Math.max(1, current)) * 100)}% at harvest
          </Pill>
        </div>
        <p className="px-1 pt-2 text-[11px] text-muted-foreground">The plotted 24-month baseline is illustrative, not a feed of observed mandi records.</p>
        <div className="mt-2 h-44" role="img" aria-label={`Illustrative modelled price trend for ${crop.name}, not observed historical market data`}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={a.series} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} interval={5} />
              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} width={48} />
              <Tooltip
                contentStyle={{ borderRadius: 12, border: '1px solid var(--border)', background: 'var(--card)', fontSize: 12 }}
                formatter={(v) => (typeof v === 'number' && !Number.isNaN(v) ? inr(v) : '—')}
              />
              <Area type="monotone" dataKey="price" name="Price" stroke="var(--chart-1)" strokeWidth={2} fill="url(#priceFill)" connectNulls={false} />
              <Line type="monotone" dataKey="forecast" name="Forecast" stroke="var(--chart-2)" strokeWidth={2} strokeDasharray="5 4" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="flex gap-4 px-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-chart-1" /> Modelled baseline</span>
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 border-t-2 border-dashed border-chart-2" /> Forecast</span>
        </div>
      </Card>

      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          { l: 'Model avg', v: inr(a.avg2y) },
          { l: 'Model low', v: inr(a.min) },
          { l: 'Model high', v: inr(a.max) },
        ].map((s) => (
          <Card key={s.l} className="p-3">
            <p className="text-[11px] text-muted-foreground">{s.l}</p>
            <p className="text-sm font-bold">{s.v}</p>
          </Card>
        ))}
      </div>

      <Card>
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Profit forecast · {acres} acres</p>
        <dl className="mt-3 grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Expected yield</dt>
          <dd className="text-right font-semibold">{Math.round(crop.yieldPerAcre * acres)} q</dd>
          <dt className="text-muted-foreground">Revenue</dt>
          <dd className="text-right font-semibold">{inr(revenuePerAcre * acres)}</dd>
          <dt className="text-muted-foreground">Cultivation cost</dt>
          <dd className="text-right font-semibold">{inr(crop.costPerAcre * acres)}</dd>
          <dt className="font-semibold">Net profit</dt>
          <dd className={`text-right text-lg font-bold ${profitPerAcre >= 0 ? 'text-success' : 'text-destructive'}`}>
            {inr(profitPerAcre * acres)}
          </dd>
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">Estimated margin {margin}% · projection uses a modelled harvest-price trend.</p>
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Risk validation</p>
          <Pill tone={riskTone}>{a.risk} risk</Pill>
        </div>
        <div className="mt-3">
          <Meter value={a.riskScore} tone={a.risk === 'High' ? 'danger' : a.risk === 'Moderate' ? 'accent' : 'primary'} />
        </div>
        <div className="mt-3 flex gap-2 text-sm">
          {a.risk === 'Low' ? (
            <ShieldCheck className="size-5 shrink-0 text-success" />
          ) : (
            <AlertTriangle className="size-5 shrink-0 text-warning" />
          )}
          <p className="text-pretty">{verdict}</p>
        </div>
      </Card>
    </div>
  )
}
