import { Hono } from "hono"

import { forwardError } from "~/lib/error"
import { expandModelsWithReasoningVariants } from "~/lib/model-routing"
import { state } from "~/lib/state"
import { cacheModels } from "~/lib/utils"

export const modelRoutes = new Hono()

modelRoutes.get("/", async (c) => {
  try {
    if (!state.models) {
      // This should be handled by startup logic, but as a fallback.
      await cacheModels()
    }

    const baseModels =
      state.models?.data.map((model) => ({
        id: model.id,
        object: "model",
        type: "model",
        created: 0, // No date available from source
        created_at: new Date(0).toISOString(), // No date available from source
        owned_by: model.vendor,
        display_name: model.name,
      })) ?? []

    // Generate reasoning-effort suffixed variants for codex and claude models
    const extraVariants = expandModelsWithReasoningVariants(baseModels).map(
      (v) => ({
        id: v.id,
        object: "model",
        type: "model",
        created: 0,
        created_at: new Date(0).toISOString(),
        owned_by: "system",
        display_name: v.id,
      }),
    )

    return c.json({
      object: "list",
      data: [...baseModels, ...extraVariants],
      has_more: false,
    })
  } catch (error) {
    return await forwardError(c, error)
  }
})
