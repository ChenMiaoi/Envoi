import { mkdir, writeFile, realpath } from "node:fs/promises"
import path from "node:path"
export async function seedFixtureTrust(dataDirectory, root) {
  const canonical = await realpath(root)
  await mkdir(dataDirectory, { recursive: true })
  const relative = path.relative(canonical, await realpath(dataDirectory))
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    throw Error("Fixture data must be inside its temporary root")
  await writeFile(
    path.join(dataDirectory, "workspace-trust.json"),
    JSON.stringify({ roots: [canonical] }),
  )
}
