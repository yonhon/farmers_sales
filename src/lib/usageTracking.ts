import { supabase } from './supabase'

export type UsageEventType = 'page_view' | 'action' | 'error'
export type UsageEventOutcome = 'success' | 'failure'

export type UsageEventInput = {
  eventType: UsageEventType
  pagePath?: string
  actionName?: string
  targetType?: string
  targetId?: string
  outcome?: UsageEventOutcome
  errorCode?: string
  messageSummary?: string
  metadata?: Record<string, string | number | boolean | null>
}

export function currentUsagePath() {
  return window.location.hash || '#/'
}

export function sanitizeUsageMessage(value: unknown) {
  const message = value instanceof Error ? value.message : String(value ?? '')
  return message
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 200)
}

export async function recordUsageEvent(input: UsageEventInput) {
  if (!supabase) return

  const { error } = await supabase.rpc('record_usage_event', {
    p_event_type: input.eventType,
    p_page_path: (input.pagePath ?? currentUsagePath()).slice(0, 255),
    p_action_name: input.actionName ?? null,
    p_target_type: input.targetType ?? null,
    p_target_id: input.targetId ?? null,
    p_outcome: input.outcome ?? null,
    p_error_code: input.errorCode ?? null,
    p_message_summary: input.messageSummary
      ? sanitizeUsageMessage(input.messageSummary)
      : null,
    p_metadata: input.metadata ?? {},
  })

  if (error && import.meta.env.DEV) {
    console.warn('Usage event could not be recorded.', error.message)
  }
}

export function installUsageErrorTracking() {
  function onError(event: ErrorEvent) {
    void recordUsageEvent({
      eventType: 'error',
      errorCode: 'window_error',
      messageSummary: event.message,
      metadata: {
        line: event.lineno || null,
        column: event.colno || null,
      },
    })
  }

  function onUnhandledRejection(event: PromiseRejectionEvent) {
    void recordUsageEvent({
      eventType: 'error',
      errorCode: 'unhandled_rejection',
      messageSummary: sanitizeUsageMessage(event.reason),
    })
  }

  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onUnhandledRejection)

  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onUnhandledRejection)
  }
}

export type UserPvRow = {
  user_id: string | null
  display_name: string
  pv: number
}

export function findTopUsageUsers<T extends UserPvRow>(rows: T[], limit = 5) {
  const totals = new Map<string, { userId: string; displayName: string; pv: number }>()
  for (const row of rows) {
    if (!row.user_id) continue
    const current = totals.get(row.user_id) ?? {
      userId: row.user_id,
      displayName: row.display_name,
      pv: 0,
    }
    current.pv += Number(row.pv)
    current.displayName = row.display_name
    totals.set(row.user_id, current)
  }
  return [...totals.values()].sort((a, b) => b.pv - a.pv).slice(0, limit)
}
