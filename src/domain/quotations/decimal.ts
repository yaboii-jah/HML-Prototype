/** Exact rational arithmetic. Division stays exact until an explicit money round. */
export type Decimal = Readonly<{ numerator: bigint; denominator: bigint }>;
const BIG_ZERO = BigInt(0);
const BIG_ONE = BigInt(1);
const BIG_TWO = BigInt(2);
const BIG_TEN = BigInt(10);
const BIG_HUNDRED = BigInt(100);

function fraction(numerator: bigint, denominator = BIG_ONE): Decimal {
  if (denominator === BIG_ZERO) throw Error("Cannot divide by zero.");
  if (denominator < BIG_ZERO) return fraction(-numerator, -denominator);
  let a = numerator < BIG_ZERO ? -numerator : numerator;
  let b = denominator;
  while (b !== BIG_ZERO) [a, b] = [b, a % b];
  return { numerator: numerator / a, denominator: denominator / a };
}

export const ZERO = fraction(BIG_ZERO);
export const ONE = fraction(BIG_ONE);
export const HUNDRED = fraction(BIG_HUNDRED);

export function decimal(value: string): Decimal {
  if (value.length > 80 || !/^-?\d+(?:\.\d+)?$/.test(value)) {
    throw Error("Enter an exact decimal value.");
  }
  const [whole, places = ""] = value.split(".");
  const sign = whole.startsWith("-") ? -BIG_ONE : BIG_ONE;
  return fraction(
    sign * BigInt(whole.replace("-", "") + places),
    BIG_TEN ** BigInt(places.length),
  );
}

export function add(a: Decimal, b: Decimal): Decimal {
  return fraction(
    a.numerator * b.denominator + b.numerator * a.denominator,
    a.denominator * b.denominator,
  );
}

export function subtract(a: Decimal, b: Decimal): Decimal {
  return add(a, { numerator: -b.numerator, denominator: b.denominator });
}

export function multiply(a: Decimal, b: Decimal): Decimal {
  return fraction(a.numerator * b.numerator, a.denominator * b.denominator);
}

export function divide(a: Decimal, b: Decimal): Decimal {
  return fraction(a.numerator * b.denominator, a.denominator * b.numerator);
}

export function absolute(value: Decimal): Decimal {
  return value.numerator < BIG_ZERO
    ? { ...value, numerator: -value.numerator }
    : value;
}

export function compare(a: Decimal, b = ZERO): -1 | 0 | 1 {
  const difference = a.numerator * b.denominator - b.numerator * a.denominator;
  return difference < BIG_ZERO ? -1 : difference > BIG_ZERO ? 1 : 0;
}

function cents(value: Decimal): bigint {
  const negative = value.numerator < BIG_ZERO;
  const numerator =
    (negative ? -value.numerator : value.numerator) * BIG_HUNDRED;
  const whole = numerator / value.denominator;
  const rounded =
    whole +
    ((numerator % value.denominator) * BIG_TWO >= value.denominator
      ? BIG_ONE
      : BIG_ZERO);
  return negative ? -rounded : rounded;
}

export function rounded(value: Decimal): Decimal {
  return fraction(cents(value), BIG_HUNDRED);
}

export function money(value: Decimal): string {
  const scaled = cents(value);
  const digits = (scaled < BIG_ZERO ? -scaled : scaled)
    .toString()
    .padStart(3, "0");
  return `${scaled < BIG_ZERO ? "-" : ""}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

export function sum(values: readonly Decimal[]): Decimal {
  return values.reduce(add, ZERO);
}

/** Formatting never converts a monetary value to a JavaScript number. */
export function php(value: string): string {
  const match = /^(-?)(\d+)\.(\d{2})$/.exec(value);
  if (!match) return "—";
  return `${match[1]}₱${match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${match[3]}`;
}
