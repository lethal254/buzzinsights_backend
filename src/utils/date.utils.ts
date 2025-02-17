import * as chrono from "chrono-node"

export function extractDateRange(
  query: string
): { start: string; end: string } | null {
  const lowerQuery = query.toLowerCase()
  const refDate = new Date()

  if (/(week|weak|wek)/.test(lowerQuery)) {
    const dayOfWeek = refDate.getDay()
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
    const monday = new Date(refDate)
    monday.setDate(refDate.getDate() + mondayOffset)
    monday.setHours(0, 0, 0, 0)
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    sunday.setHours(23, 59, 59, 999)
    return { start: monday.toISOString(), end: sunday.toISOString() }
  }
  if (/month/.test(lowerQuery)) {
    const start = new Date(refDate.getFullYear(), refDate.getMonth(), 1)
    const end = new Date(refDate.getFullYear(), refDate.getMonth() + 1, 0)
    end.setHours(23, 59, 59, 999)
    return { start: start.toISOString(), end: end.toISOString() }
  }
  if (/quarter/.test(lowerQuery)) {
    const month = refDate.getMonth()
    const quarter = Math.floor(month / 3)
    const start = new Date(refDate.getFullYear(), quarter * 3, 1)
    const end = new Date(refDate.getFullYear(), quarter * 3 + 3, 0)
    end.setHours(23, 59, 59, 999)
    return { start: start.toISOString(), end: end.toISOString() }
  }
  if (/year/.test(lowerQuery)) {
    const start = new Date(refDate.getFullYear(), 0, 1)
    const end = new Date(refDate.getFullYear(), 11, 31)
    end.setHours(23, 59, 59, 999)
    return { start: start.toISOString(), end: end.toISOString() }
  }
  const results = chrono.parse(query, refDate)
  if (results.length === 0) return null
  const result = results[0]
  let start = result.start ? result.start.date() : null
  let end = result.end ? result.end.date() : null
  if (start && !end) {
    end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  }
  if (start && end)
    return { start: start.toISOString(), end: end.toISOString() }
  return null
}
