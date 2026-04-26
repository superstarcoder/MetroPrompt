// ============================================================
// SIMULATION TIMING
// 1 tick = 10 seconds real time = 1 hour in sim
// 1 day = 24 ticks = 240 seconds real time (4 minutes)
// 7 days = 168 ticks = 1680 seconds real time (28 minutes)
// ============================================================

// HUNGER RATE
// Source: USDA Dietary Guidelines Advisory Committee, 2020
// "Frequency of Eating in the US Population"
// https://www.dietaryguidelines.gov/sites/default/files/2020-07/PartD_Ch13_FreqEating_first-print.pdf
// Finding: 64% of Americans consume 3 meals/day, 28% consume 2 meals/day,
// 8% are constant grazers (5.7+ eating occasions/day)

// TIREDNESS RATE
// Source: CDC, Morbidity and Mortality Weekly Report (MMWR), 2016
// "Prevalence of Healthy Sleep Duration among Adults — United States, 2014"
// https://www.cdc.gov/mmwr/volumes/65/wr/mm6506a1.htm
// Finding: 65.2% of adults sleep 7+ hours (adequate),
// 33.2% sleep <7 hours (short sleep duration),
// ~1.6% are long sleepers (9+ hours)
//
// Additional source: CDC BRFSS / Preventing Chronic Disease, 2023
// "Prevalence and Geographic Patterns of Self-Reported Short Sleep Duration"
// https://www.cdc.gov/pcd/issues/2023/22_0400.htm

// BOREDOM RATE
// Source: USDA Economic Research Service, 2011
// "How Much Time Do Americans Spend Eating?"
// https://www.usda.gov/media/blog/2011/11/22/how-much-time-do-americans-spend-eating
// Finding: Americans spend ~67 min/day on primary eating,
// remainder split between work, leisure, errands.
// 4% report no primary eating (constant grazers),
// 8% spend 4.5+ hours eating/drinking daily.
//
// Note: No direct "boredom rate" dataset exists at the federal level.
// Distribution modeled as normal based on general population
// leisure/activity patterns from the American Time Use Survey (ATUS).
// Source: Bureau of Labor Statistics, American Time Use Survey
// https://www.bls.gov/tus/

export const SIMULATION = {
  tick_interval_ms: 10000,
  hours_per_tick: 1,
  ticks_per_day: 24,
  total_days: 7,
  total_ticks: 168,
} as const;

// How many ticks a citizen stays inside a property after entering. Each tick
// inside applies the property's full *_decrease values to that citizen's
// needs, so 2 ticks at a 10-decrease building fully resets the relevant need.
export const STAY_DURATION_TICKS = 2;

// How many grid cells a citizen advances along their path per sim tick.
// Visual lerp covers the full distance over the tick interval, so this also
// scales walking speed proportionally (2 = 2x faster).
export const WALK_CELLS_PER_TICK = 3;

// ============================================================
// RATE JITTER
// Multiplies a citizen's base rate by a uniform sample in [min, max]
// each tick so citizens with similar rates don't act in lockstep.
// ============================================================

export const RATE_JITTER = {
  min: 0.7,
  max: 1.3,
} as const;

export const applyJitter = (baseRate: number): number =>
  baseRate * (RATE_JITTER.min + Math.random() * (RATE_JITTER.max - RATE_JITTER.min));

// ============================================================
// DECISION WEIGHTS
// Citizens don't always pick optimally — 70% address highest need,
// 30% pick a random valid destination.
// ============================================================

export const DECISION_WEIGHTS = {
  optimal_chance: 0.70,
  random_chance: 0.30,
} as const;

// ============================================================
// PERSONALITY RATE DISTRIBUTIONS (per tick = per hour)
// Each rate represents how much a need (1–10 scale) increases per tick.
// rate = 9 / hours_between_need_fulfillment
// See real-world sources cited per distribution below.
// ============================================================

export type RateDistribution = {
  groups: { mean: number; weight: number }[];
  stdDev: number;
  min: number;
  max: number;
};

// HUNGER (per hour)
// Source: USDA Dietary Guidelines Advisory Committee, 2020
// 64% eat 3 meals/day (~5.3 hrs gap → 0.19), 28% eat 2 meals/day (~8 hrs → 0.12),
// 8% constant grazers (~2.8 hrs → 0.25)
export const HUNGER_RATE_DISTRIBUTION: RateDistribution = {
  groups: [
    { mean: 0.19, weight: 0.64 },
    { mean: 0.12, weight: 0.28 },
    { mean: 0.25, weight: 0.08 },
  ],
  stdDev: 0.03,
  min: 0.09,
  max: 0.28,
};

// TIREDNESS (per hour)
// Source: CDC MMWR, 2016 — 65.2% sleep 7+ hrs (adequate), 33.2% <7 hrs (under-rested),
// 1.6% great sleepers. Under-rested accumulate fatigue faster (sleep debt) → higher rate.
export const TIREDNESS_RATE_DISTRIBUTION: RateDistribution = {
  groups: [
    { mean: 0.13, weight: 0.652 },
    { mean: 0.22, weight: 0.332 },
    { mean: 0.09, weight: 0.016 },
  ],
  stdDev: 0.03,
  min: 0.06,
  max: 0.25,
};

// BOREDOM (per hour)
// Source: BLS American Time Use Survey, 2023 + US Census 2023.
// Working-age low-leisure 40% (3.8 hrs leisure → 0.20), moderate 45% (5.2 hrs → 0.15),
// retirees/high-leisure 15% (7.6 hrs → 0.10).
export const BOREDOM_RATE_DISTRIBUTION: RateDistribution = {
  groups: [
    { mean: 0.20, weight: 0.40 },
    { mean: 0.15, weight: 0.45 },
    { mean: 0.10, weight: 0.15 },
  ],
  stdDev: 0.02,
  min: 0.06,
  max: 0.25,
};

// ============================================================
// DISTRIBUTION HELPERS
// ============================================================

// Box-Muller transform for standard normal sampling.
export const randomNormal = (mean: number, stdDev: number): number => {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * stdDev;
};

export const clampedNormal = (
  mean: number,
  stdDev: number,
  min: number,
  max: number,
): number => Math.max(min, Math.min(max, randomNormal(mean, stdDev)));

// Pick a group by weight, then sample a clamped normal around its mean.
export const weightedNormal = (distribution: RateDistribution): number => {
  const roll = Math.random();
  let cumulative = 0;
  let selectedMean = distribution.groups[0].mean;
  for (const group of distribution.groups) {
    cumulative += group.weight;
    if (roll <= cumulative) {
      selectedMean = group.mean;
      break;
    }
  }
  return clampedNormal(selectedMean, distribution.stdDev, distribution.min, distribution.max);
};