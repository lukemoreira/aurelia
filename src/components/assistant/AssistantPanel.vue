<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { ref } from 'vue'
import Button from '@/components/ui/Button.vue'
import Field from '@/components/ui/Field.vue'
import Icon from '@/components/ui/Icon.vue'
import Textarea from '@/components/ui/Textarea.vue'
import { useAssistant } from '@/composables/useAssistant'
import { useStoryBase } from '@/composables/useStoryBase'
import { useLayoutStore } from '@/stores/layout'
import { useWorkspaceStore } from '@/stores/workspace'
import ConnectClaude from './ConnectClaude.vue'
import ReviewInbox from './ReviewInbox.vue'

/** The assistant's tab: connect, the conversation with its activity log, and the Review inbox. */
const a = useAssistant()
const layout = useLayoutStore()
const base = useStoryBase()
const ws = useWorkspaceStore()
const message = ref('')

async function send() {
  const text = message.value
  message.value = ''
  if (!(await a.send(text))) message.value ||= text
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <p v-if="a.state.value === 'sign-in-again'" class="m-0 text-[12.5px] text-ink-2">
      Your sign-in to this server ran out. Reload the page to sign in again.
    </p>
    <p v-else-if="a.state.value === 'not-installed'" class="m-0 text-[12.5px] text-ink-2">
      The assistant is still being set up on your server. Try again in a few minutes.
    </p>
    <ConnectClaude v-else-if="a.state.value === 'signed-out'" />
    <template v-else-if="a.state.value === 'signed-in'">
      <p v-if="!a.folder.value" class="m-0 text-[12.5px] text-ink-2">
        The assistant reads the copy of this workspace on your server. Keep it in sync first:
        <Button size="sm" variant="quiet" @click="layout.backupOpen = true"
          >Backup and sync…</Button
        >
      </p>
      <section v-else aria-labelledby="assistant-chat" class="flex flex-col gap-3">
        <h3
          id="assistant-chat"
          class="m-0 text-[11px] font-semibold uppercase tracking-[.08em] text-ink-3"
        >
          Assistant
        </h3>
        <div v-if="ws.bookId && !a.turns.value.length" class="flex flex-col gap-1.5">
          <p v-if="base.empty.value" class="m-0 text-[12.5px] text-ink-2">
            This book has no story base yet: its genre, subject area, audience, intentions,
            objectives, world and history, main narrative and main characters. The assistant can set
            it up with you, one short question at a time.
          </p>
          <Button size="sm" :disabled="a.busy.value" @click="a.guidedStart()"
            ><Icon name="spark" :size="14" />Set up the story base with the assistant</Button
          >
        </div>
        <ol class="m-0 flex list-none flex-col gap-3 p-0" aria-live="polite">
          <li v-for="(t, i) in a.turns.value" :key="i" class="flex flex-col gap-1.5">
            <p
              v-if="t.role === 'author'"
              class="m-0 self-end whitespace-pre-wrap rounded-lg bg-raised px-2.5 py-1.5 text-[13px]"
            >
              {{ t.text }}
            </p>
            <template v-else>
              <ul
                v-if="t.tools.length"
                class="m-0 flex list-none flex-col gap-0.5 p-0 text-[12px] text-ink-3"
              >
                <li v-for="(tool, k) in t.tools" :key="k" class="flex items-center gap-1">
                  <Icon name="check" :size="12" />{{ tool }}
                </li>
              </ul>
              <p v-if="t.text" class="m-0 whitespace-pre-wrap text-[13px] leading-relaxed">
                {{ t.text }}
              </p>
              <p v-if="t.error" role="alert" class="m-0 text-[12.5px] text-danger">{{ t.error }}</p>
              <p
                v-if="a.busy.value && i === a.turns.value.length - 1 && !t.text"
                class="m-0 text-[12.5px] text-ink-3"
              >
                Reading…
              </p>
            </template>
          </li>
        </ol>
        <form class="flex flex-col gap-2" @submit.prevent="send">
          <Field
            label="Message the assistant"
            description="Read and suggest only · no edits without you"
          >
            <Textarea
              v-model="message"
              rows="3"
              @keydown.meta.enter="send"
              @keydown.ctrl.enter="send"
            />
          </Field>
          <div class="flex items-center gap-1.5">
            <Button
              type="submit"
              size="sm"
              variant="primary"
              :loading="a.busy.value"
              :disabled="!message.trim() || a.busy.value"
              >Send</Button
            >
            <Button
              v-if="a.turns.value.length"
              size="sm"
              variant="quiet"
              class="ml-auto"
              :disabled="a.busy.value"
              @click="a.clearChat()"
              >Clear chat</Button
            >
            <Button
              size="sm"
              variant="quiet"
              :class="{ 'ml-auto': !a.turns.value.length }"
              @click="a.disconnect()"
              >Sign out of Claude Code</Button
            >
          </div>
        </form>
      </section>
      <ReviewInbox class="border-t border-line pt-4" />
    </template>
  </div>
</template>
