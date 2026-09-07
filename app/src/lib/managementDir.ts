import { envoi } from "./desktop"
// Per-project state directory: `.envoi`. Reads fall back to the pre-rename `.paperdesk`.
export const managementDirName = ".envoi"
export const legacyDirName = ".paperdesk"
export const projectConfigPath = `${managementDirName}/project.json`
export const legacyProjectConfigPath = `${legacyDirName}/project.json`

export async function projectConfigFile(
  rootPath: string,
): Promise<{ path: string; text: string } | undefined> {
  for (const name of [managementDirName, legacyDirName]) {
    const result = await envoi()
      .fsRead(rootPath, `${name}/project.json`)
      .catch(() => undefined)
    if (result?.text !== undefined) return { path: `${name}/project.json`, text: result.text }
  }
  return undefined
}
