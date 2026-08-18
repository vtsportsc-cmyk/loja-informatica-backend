/**
 * Formata e valida numeros de telefone brasileiros.
 * Aceita formatos: 11999999999, (11) 99999-9999, 5511999999999, etc.
 */

const PHONE_REGEX = /^(?:\+?55)?\s*\(?\d{2}\)?\s*9?\d{4}[-\s]?\d{4}$/;

export function formatPhoneBR(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 0) return '';

  let d = digits;
  if (d.startsWith('55') && d.length > 11) {
    d = d.slice(2);
  }

  if (d.length === 11) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }
  if (d.length === 10) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  }
  return raw;
}

export function isValidPhoneBR(raw: string): boolean {
  return PHONE_REGEX.test(raw);
}

export function phoneToWhatsApp(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('55')) return digits;
  return `55${digits}`;
}
