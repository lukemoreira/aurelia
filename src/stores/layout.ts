// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { leavePanelFocus } from '@/composables/useFocusMain'
import { useMediaQuery } from '@/composables/useMediaQuery'
import { useResizablePanel } from '@/composables/useResizablePanel'

/** Panels, sheets and the palette: the shell's own state. */
export const useLayoutStore = defineStore('layout', () => {
  const nav = useResizablePanel({
    key: 'panel.navigator',
    initial: 272,
    min: 200,
    max: 420,
    side: 'left',
  })
  const inspector = useResizablePanel({
    key: 'panel.inspector',
    initial: 320,
    min: 260,
    max: 480,
    side: 'right',
  })
  const wide = useMediaQuery('(min-width: 1024px)')
  const navSheet = ref(false)
  const inspectorSheet = ref(false)
  const paletteOpen = ref(false)
  const backupOpen = ref(false)

  // Below 1024px the panels are sheets; a sheet left open has no place on a wide screen.
  watch(wide, (isWide) => {
    if (isWide) navSheet.value = inspectorSheet.value = false
  })

  function toggleNavigator() {
    if (!wide.value) navSheet.value = !navSheet.value
    else {
      if (!nav.collapsed.value) leavePanelFocus('navigator')
      nav.toggle()
    }
  }
  function toggleInspector() {
    if (!wide.value) inspectorSheet.value = !inspectorSheet.value
    else {
      if (!inspector.collapsed.value) leavePanelFocus('inspector')
      inspector.toggle()
    }
  }
  const closeSheets = () => (navSheet.value = inspectorSheet.value = false)

  return {
    nav,
    inspector,
    wide,
    navSheet,
    inspectorSheet,
    paletteOpen,
    backupOpen,
    toggleNavigator,
    toggleInspector,
    closeSheets,
  }
})
