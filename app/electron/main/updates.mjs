const repository = "https://github.com/ChenMiaoi/Envoi"

export function newerVersion(candidate, current) {
  const parse = (value) => /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value)?.slice(1).map(Number)
  const next = parse(candidate)
  const installed = parse(current)
  if (!next || !installed) throw Error("Invalid release version")
  for (let i = 0; i < 3; i++) {
    if (next[i] !== installed[i]) return next[i] > installed[i]
  }
  return false
}

export async function checkUpdate(currentVersion, request = fetch) {
  const response = await request("https://api.github.com/repos/ChenMiaoi/Envoi/releases/latest", {
    headers: { Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(15000),
  })
  if ([401, 403, 404].includes(response.status)) {
    return { currentVersion, status: "inaccessible" }
  }
  if (!response.ok) throw Error(`GitHub HTTP ${response.status}`)
  const release = await response.json()
  if (release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(release.tag_name))
    throw Error("Invalid stable release")
  const available = newerVersion(release.tag_name, currentVersion)
  return {
    currentVersion,
    latestVersion: release.tag_name.slice(1),
    status: available ? "available" : "current",
    url: `${repository}/releases/tag/${encodeURIComponent(release.tag_name)}`,
  }
}
