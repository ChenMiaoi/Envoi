export class TaskRegistry {
  tasks = new Map()
  run(key, owner, root, operation) {
    if (this.tasks.has(key)) return Promise.reject(Error("此项目已有同类任务正在运行。"))
    const controller = new AbortController()
    const entry = { owner, root, controller, promise: null }
    this.tasks.set(key, entry)
    entry.promise = Promise.resolve()
      .then(() => {
        controller.signal.throwIfAborted()
        return operation(controller.signal)
      })
      .finally(() => {
        if (this.tasks.get(key) === entry) this.tasks.delete(key)
      })
    return entry.promise
  }
  async cancel(owner, root) {
    const matches = [...this.tasks.values()].filter(
      (task) =>
        (owner === undefined || task.owner === owner) && (root === undefined || task.root === root),
    )
    for (const task of matches) task.controller.abort(Error("任务已取消"))
    await Promise.allSettled(matches.map((task) => task.promise))
  }
}
