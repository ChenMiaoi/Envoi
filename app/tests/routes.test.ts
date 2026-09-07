import { test } from "node:test"
import assert from "node:assert/strict"
import { createMemoryRouter, redirect } from "react-router"
import { resolvePage, viewPaths } from "../src/navigation/routes"
function ready(router: ReturnType<typeof createMemoryRouter>, pathname: string) {
  if (
    router.state.initialized &&
    router.state.navigation.state === "idle" &&
    router.state.location.pathname === pathname
  )
    return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe()
      reject(Error(`Navigation did not settle at ${pathname}`))
    }, 2000)
    const unsubscribe = router.subscribe((state) => {
      if (
        state.initialized &&
        state.navigation.state === "idle" &&
        state.location.pathname === pathname
      ) {
        clearTimeout(timer)
        unsubscribe()
        resolve()
      }
    })
  })
}
function routerAt(path: string) {
  return createMemoryRouter(
    [
      {
        path: "*",
        loader: ({ request }) => {
          const page = resolvePage(new URL(request.url).pathname)
          if (page.redirect) return redirect(page.redirect)
          return page.view ?? "not-found"
        },
      },
    ],
    { initialEntries: [path] },
  )
}
test("all workspace paths resolve directly, root and trailing slash canonicalize, unknown paths stay not-found", () => {
  for (const [view, path] of Object.entries(viewPaths)) assert.equal(resolvePage(path).view, view)
  assert.equal(resolvePage("/").redirect, "/reader")
  assert.equal(resolvePage("/settings").redirect, "/settings/global/general")
  assert.equal(resolvePage("/settings/global/ai").view, "settings")
  assert.equal(resolvePage("/settings/project/ai").view, "settings")
  assert.equal(resolvePage("/reader/").redirect, "/reader")
  assert.deepEqual(resolvePage("/unknown"), {})
  assert.deepEqual(resolvePage("/reader/private/path"), {})
})
test("router supports root redirect, page navigation and browser history back/forward", async () => {
  const router = routerAt("/")
  try {
    await ready(router, "/reader")
    assert.equal(router.state.loaderData["0"], "reader")
    await router.navigate("/writer")
    await ready(router, "/writer")
    await router.navigate("/library")
    await ready(router, "/library")
    await router.navigate(-1)
    await ready(router, "/writer")
    await router.navigate(-1)
    await ready(router, "/reader")
    await router.navigate(1)
    await ready(router, "/writer")
    await router.navigate("/does-not-exist")
    await ready(router, "/does-not-exist")
    assert.equal(router.state.loaderData["0"], "not-found")
  } finally {
    router.dispose()
  }
})
test("refresh-equivalent direct entry does not depend on previous view state", async () => {
  for (const path of Object.values(viewPaths)) {
    const router = routerAt(path)
    try {
      await ready(router, resolvePage(path).redirect ?? path)
      assert.equal(router.state.loaderData["0"], resolvePage(path).view)
    } finally {
      router.dispose()
    }
  }
})

test("settings scope/category pages support direct entry and history", async () => {
  const paths = [
    "/settings/global/general",
    "/settings/global/editor",
    "/settings/global/compile",
    "/settings/global/references",
    "/settings/project/general",
    "/settings/project/editor",
    "/settings/project/compile",
    "/settings/project/references",
  ]
  for (const path of paths) {
    const router = routerAt(path)
    try {
      await ready(router, path)
      assert.equal(router.state.loaderData["0"], "settings")
    } finally {
      router.dispose()
    }
  }
  const router = routerAt(paths[1])
  try {
    await ready(router, paths[1])
    await router.navigate(paths[6])
    await ready(router, paths[6])
    await router.navigate(-1)
    await ready(router, paths[1])
  } finally {
    router.dispose()
  }
})
