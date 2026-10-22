/** Match serialized string values without coercing arrays or other objects. */
export function oneOf<const T extends readonly string[]>(value: unknown, choices: T): value is T[number] {
  return typeof value === 'string' && choices.includes(value);
}
