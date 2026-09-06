// Per-project state directory: `.envoi`. Reads fall back to the pre-rename `.paperdesk`.
export const managementDirName = '.envoi';
export const legacyDirName = '.paperdesk';
export const projectConfigPath = `${managementDirName}/project.json`;
export const legacyProjectConfigPath = `${legacyDirName}/project.json`;

export async function managementDirectory(directory: FileSystemDirectoryHandle): Promise<FileSystemDirectoryHandle | undefined> {
  for (const name of [managementDirName, legacyDirName]) {
    try { return await directory.getDirectoryHandle(name); } catch (error) { if ((error as Error).name !== 'NotFoundError') throw error; }
  }
  return undefined;
}

export async function projectConfigFile(directory: FileSystemDirectoryHandle): Promise<{ path: string; text: string; handle: FileSystemFileHandle } | undefined> {
  for (const name of [managementDirName, legacyDirName]) {
    try {
      const folder = await directory.getDirectoryHandle(name);
      const handle = await folder.getFileHandle('project.json');
      return { path: `${name}/project.json`, text: await (await handle.getFile()).text(), handle };
    } catch (error) { if ((error as Error).name !== 'NotFoundError') throw error; }
  }
  return undefined;
}
