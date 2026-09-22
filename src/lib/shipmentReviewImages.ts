// Source images live only in the browser (object URLs). Selecting more files adds to the loaded set so
// a month whose scans sit in several folders can be loaded in several passes; a file with the same
// name as an already loaded one replaces it.
export function mergeSourceImageUrls<T extends { name: string; type: string }>(
  current: Record<string, string>,
  files: T[],
  createUrl: (file: T) => string,
  revokeUrl: (url: string) => void,
) {
  const merged = { ...current }
  let added = 0
  files.forEach((file) => {
    if (!file.type.startsWith('image/')) return
    if (merged[file.name]) revokeUrl(merged[file.name])
    merged[file.name] = createUrl(file)
    added += 1
  })
  return added > 0 ? { urls: merged, added } : { urls: current, added: 0 }
}
