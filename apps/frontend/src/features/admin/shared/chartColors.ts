/**
 * Admin chart palette. Categorical slots are assigned in this fixed order (brand blue first) and never cycled into new hues; a list
 * longer than eight wraps, which is acceptable because every admin bar carries its own visible label and count. Validated with the
 * dataviz palette checker on white: lightness band, chroma floor, colour-blind adjacent separation (worst ΔE 9.1) and normal-vision
 * floor all pass; slots 3–5 sit under 3:1 against white, so they are only used beside a text label, never alone.
 */
export const CHART_SERIES = ['#2563eb', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'] as const;

export const seriesColor = (index: number) => CHART_SERIES[((index % CHART_SERIES.length) + CHART_SERIES.length) % CHART_SERIES.length]!;

/** State colours are reserved for state (the design-system success / warning / error tokens) and never reused as a series slot. */
export const STATE_COLOR = { good: '#22c55e', warning: '#f59e0b', critical: '#ef4444' } as const;
