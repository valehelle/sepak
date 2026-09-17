/** Stored form: Malaysian mobile as international digits, no plus --
 *  "601" then 8 or 9 digits. Mirrors contacts_phone_format in
 *  supabase/migrations/0009_contacts.sql, which is the authority. */
const STORED_RE = /^601[0-9]{8,9}$/

/** Takes whatever a person types -- "012-345 6789", "+60 12 345 6789",
 *  "0123456789" -- and returns the stored form, or null if it is not a
 *  Malaysian mobile number. Only digits matter; everything else is
 *  punctuation people add for their own eyes. */
export function normalisePhone(input: string): string | null {
  const digits = input.replace(/\D/g, '')
  const withCountry = digits.startsWith('0') ? `6${digits}` : digits
  return STORED_RE.test(withCountry) ? withCountry : null
}

/** The stored form back into the national style people recognise:
 *  012-345 6789, or 011-2345 6789 for the longer 011 range. */
export function formatPhone(stored: string): string {
  if (!STORED_RE.test(stored)) return stored
  const national = `0${stored.slice(2)}`
  const prefix = national.slice(0, 3)
  const rest = national.slice(3)
  const split = rest.length === 7 ? 3 : 4
  return `${prefix}-${rest.slice(0, split)} ${rest.slice(split)}`
}

export function whatsappLink(stored: string): string {
  return `https://wa.me/${stored}`
}

export function telLink(stored: string): string {
  return `tel:+${stored}`
}
