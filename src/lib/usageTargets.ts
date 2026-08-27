export function formatUsageTarget(
  targetType: string | null,
  targetId: string | null,
  targetName?: string,
) {
  if (!targetType) return '—'
  if (!targetId) return targetType
  return `${targetType}: ${targetName ?? targetId}`
}
