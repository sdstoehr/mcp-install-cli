const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_-]*)\s*\}\}/g;
const SECRET_NAME = /token|key|secret|pass(word)?|pwd|auth|credential|bearer/i;

/** Returns placeholder names in order of first appearance, without duplicates. */
export function findPlaceholders(...inputs: string[]): string[] {
  const names = new Set<string>();
  for (const input of inputs) {
    for (const match of input.matchAll(PLACEHOLDER)) names.add(match[1]!);
  }
  return [...names];
}

export function isSecretName(name: string): boolean {
  return SECRET_NAME.test(name);
}

export type Encoder = (value: string) => string;

export function substitute(
  input: string,
  values: Record<string, string>,
  encode: Encoder = (v) => v,
): string {
  return input.replace(PLACEHOLDER, (whole, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`No value for placeholder {{${name}}}`);
    return encode(value);
  });
}

/** Replaces secret values (plain, URL-encoded and JSON-escaped) for display. */
export function maskSecrets(text: string, secrets: string[]): string {
  const forms = secrets
    .flatMap((s) => [s, encodeURIComponent(s), JSON.stringify(s).slice(1, -1)])
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  return forms.reduce((out, form) => out.split(form).join('••••••'), text);
}
