import { builtinPlugins } from "./plugin-registry.mjs"

export class PluginHost {
  constructor(plugins = builtinPlugins) {
    this.plugins = new Map(plugins.map((plugin) => [plugin.id, plugin]))
    this.instances = new Map()
  }

  key(id, scope) {
    if (!this.plugins.has(id)) throw Error(`Unknown plugin: ${id}`)
    if (typeof scope !== "string" || !scope) throw Error("Plugin scope is required")
    return `${id}\0${scope}`
  }

  status(id, scope) {
    return this.instances.get(this.key(id, scope))?.state ?? "inactive"
  }

  async activate(id, scope, start) {
    const key = this.key(id, scope)
    const previous = this.instances.get(key)
    if (previous?.state === "active" || previous?.state === "activating") return previous.ready
    if (previous?.state === "disabled") throw Error(`Plugin disabled: ${id}`)
    const disposers = []
    const instance = { state: "activating", disposers, ready: null }
    this.instances.set(key, instance)
    const context = {
      plugin: this.plugins.get(id),
      scope,
      add(dispose) {
        if (typeof dispose !== "function") throw Error("Plugin disposer must be a function")
        if (instance.released) throw Error("Plugin activation was cancelled")
        disposers.push(dispose)
      },
    }
    instance.ready = (async () => {
      try {
        const value = await start(context)
        if (this.instances.get(key) !== instance) {
          await this.release(instance)
          throw Error(`Plugin activation cancelled: ${id}`)
        }
        instance.state = "active"
        return value
      } catch (error) {
        await this.release(instance)
        if (this.instances.get(key) === instance) instance.state = "failed"
        throw error
      }
    })()
    return instance.ready
  }

  async release(instance) {
    if (instance.released) return
    instance.released = true
    for (const dispose of instance.disposers.reverse()) {
      try {
        await dispose()
      } catch {
        // Continue releasing the remaining resources.
      }
    }
  }

  async deactivate(id, scope, disabled = false) {
    const key = this.key(id, scope)
    const instance = this.instances.get(key)
    if (instance) {
      this.instances.delete(key)
      await this.release(instance)
    }
    if (disabled) this.instances.set(key, { state: "disabled", disposers: [] })
  }

  enable(id, scope) {
    const key = this.key(id, scope)
    if (this.instances.get(key)?.state === "disabled") this.instances.delete(key)
  }

  async disposeScope(scope) {
    for (const key of [...this.instances.keys()])
      if (key.endsWith(`\0${scope}`)) {
        const id = key.slice(0, key.indexOf("\0"))
        await this.deactivate(id, scope)
      }
  }
}
