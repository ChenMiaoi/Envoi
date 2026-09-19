// Pi's documented Node SDK provides explicit sessions/auth/tools without loading personal extensions.
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { atomicJson, dataDir, jsonFile, safeId, withDataLock } from "../local-data.mjs"

export function sessionDir(project) {
  return path.join(dataDir, project === "global" ? "global" : `projects/${safeId(project)}`, "chat")
}
export async function saveRecord(project, record) {
  return atomicJson(path.join(sessionDir(project), safeId(record.id) + ".json"), record)
}
export function newRecord(project) {
  return withDataLock("chat-index:" + project, () => newRecordLocked(project))
}
async function newRecordLocked(project) {
  const record = {
    id: randomUUID(),
    name: "新会话",
    created: Date.now(),
    messages: [],
    status: "idle",
  }
  const index = await jsonFile(path.join(sessionDir(project), "index.json"), [])
  await saveRecord(project, record)
  await atomicJson(path.join(sessionDir(project), "index.json"), [record.id, ...index])
  await atomicJson(path.join(sessionDir(project), "active.json"), { id: record.id })
  return record
}

export function createSessionRepository({ runtimes, nativeFailure }) {
  async function chatRecord(project, id) {
    const record = await jsonFile(path.join(sessionDir(project), safeId(id) + ".json"), null)
    if (record?.status === "running" && !runtimes.has(project)) {
      record.status = "cancelled"
      await saveRecord(project, record)
    }
    if (record?.piFile) {
      try {
        const lines = (
          await readFile(
            path.join(sessionDir(project), safeId(id), path.basename(record.piFile)),
            "utf8",
          )
        )
          .trim()
          .split("\n")
        const failures = lines
          .map((line) => JSON.parse(line).message)
          .filter((message) => message?.role === "assistant" && message.stopReason === "error")
        const targets = record.messages.filter(
          (message) => message.role === "assistant" && message.error,
        )
        if (failures.length === targets.length)
          for (let i = 0; i < targets.length; i++)
            targets[i].error = nativeFailure(
              failures[i].errorMessage,
              Number(String(failures[i].errorMessage ?? "").match(/\b([45]\d\d)\b/)?.[1]) ||
                undefined,
            ).message
      } catch {
        /* Existing metadata remains available if native history cannot be read. */
      }
    }
    return record
  }
  async function listRecords(project, query = "") {
    const index = await jsonFile(path.join(sessionDir(project), "index.json"), [])
    return Promise.all(index.map((id) => chatRecord(project, id))).then((rows) =>
      rows
        .filter(Boolean)
        .filter(
          (row) =>
            !query ||
            [row.name, ...row.messages.map((message) => message.text + " " + (message.error ?? ""))]
              .join(" ")
              .toLocaleLowerCase()
              .includes(query.toLocaleLowerCase()),
        )
        .map(({ messages, ...row }) => ({
          ...row,
          count: messages.length,
          running: runtimes.get(project)?.record?.id === row.id,
        })),
    )
  }

  return { chatRecord, listRecords }
}
