<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed } from 'vue'
import { useSharedChangeForm } from '@/composables/useChangeForm'
import { useContinuityModel } from '@/composables/useContinuityModel'
import { useWorkspaceStore } from '@/stores/workspace'
import ChangeDialog from './ChangeDialog.vue'

/**
 * The one "What changes in this scene?" board of the app. It is mounted once, in the shell, so the
 * inspector's Add, the palette, the shortcut and "Mark as change" can all open it, whatever panel is
 * showing.
 */
const ws = useWorkspaceStore()
const form = useSharedChangeForm()
const { model } = useContinuityModel()
const where = computed(() => {
  const s = model.value?.byId.get(ws.sceneId ?? '')
  return s ? `${s.ref} · ${s.title}` : ''
})
</script>

<template>
  <ChangeDialog v-if="ws.sceneId" :form="form" :where="where" />
</template>
