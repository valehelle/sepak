export function firstOf<T>(items: readonly T[]): T {
  const [head] = items
  if (head === undefined) throw new Error('expected at least one element')
  return head
}
