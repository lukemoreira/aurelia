// SPDX-License-Identifier: AGPL-3.0-or-later
import { computed, ref, watch } from 'vue'
import { checkTitle } from '@/domain/titles'
import { wordsFor } from '@/storage/errors'
import { useEditsStore } from '@/stores/edits'

/** The "Rename chapter" / "New book" dialog: the name being typed, whether it may be used, and what happens when it is. */
export function useNameDialog() {
  const edits = useEditsStore()
  const name = ref('')
  const busy = ref(false)
  const failure = ref('')

  const open = computed({
    get: () => !!edits.ask,
    set: (v: boolean) => {
      if (!v) edits.ask = null
    },
  })
  watch(
    () => edits.ask,
    (ask) => {
      if (!ask) return
      name.value = ask.initial
      failure.value = ''
    },
  )

  const checked = computed(() => checkTitle(name.value))
  const error = computed(() => checked.value.error)
  const ready = computed(() => checked.value.ok && checked.value.title !== edits.ask?.initial)

  async function save() {
    const ask = edits.ask
    if (!ask || !ready.value || busy.value) return
    busy.value = true
    failure.value = ''
    try {
      await ask.run(checked.value.title)
      edits.ask = null
    } catch (e) {
      failure.value = wordsFor(e, 'That did not work. Nothing was lost.')
    } finally {
      busy.value = false
    }
  }

  return { ask: computed(() => edits.ask), open, name, error, failure, ready, busy, save }
}
