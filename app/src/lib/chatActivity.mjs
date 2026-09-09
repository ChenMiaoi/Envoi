// Keep the provider's public stream in order; never synthesize thinking text.
export function appendChatEvent(message, event) {
  if (event.type === "metrics") return { ...message, metrics: event.metrics }
  const time = event.time ?? Date.now()
  const parts = [...(message.parts ?? [])]
  if (event.type === "delta" || event.type === "thinking") {
    const type = event.type === "delta" ? "text" : "thinking"
    const last = parts.at(-1)
    if (last?.type === type)
      parts[parts.length - 1] = { ...last, text: last.text + event.text, updated: time }
    else parts.push({ type, text: event.text, time, updated: time })
  } else if (event.type === "tool") {
    const index = event.id ? parts.findIndex((p) => p.type === "tool" && p.id === event.id) : -1
    if (index < 0) parts.push({ ...event, time, updated: time })
    else
      parts[index] = {
        ...parts[index],
        ...event,
        time: parts[index].time,
        updated: time,
        input: parts[index].input ?? parts[index].detail,
      }
  } else return message
  return {
    ...message,
    parts,
    text: message.text + (event.type === "delta" ? event.text : ""),
    ...(event.type === "tool" && event.phase !== "update"
      ? { tools: [...(message.tools ?? []), event] }
      : {}),
  }
}
