<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import Button from '@/components/ui/Button.vue'
import Field from '@/components/ui/Field.vue'
import Input from '@/components/ui/Input.vue'
import { useAssistant } from '@/composables/useAssistant'

/**
 * "Claude Code on this server": Claude Code's OWN sign-in, run on the server for this person alone.
 * Its words are shown as they come (web addresses made clickable, nothing else touched), and the code
 * Claude's page gives is passed to it as typed. Aurelia's own code keeps none of it; Claude Code saves
 * the sign-in in this person's own folder on the server, which the server's owner can read.
 */
const a = useAssistant()
const code = ref('')
const sending = ref(false)

/** The program's text, split so its web addresses can be links. Display only. */
const pieces = computed(() =>
  a.loginText.value.split(/(https:\/\/[^\s<>"]+)/g).map((text, i) => ({ text, link: i % 2 === 1 })),
)

async function send() {
  sending.value = true
  await a.sendLine(code.value)
  code.value = ''
  sending.value = false
}
</script>

<template>
  <section aria-labelledby="connect-claude" class="flex flex-col gap-3">
    <h3 id="connect-claude" class="m-0 text-[13px] font-semibold">Claude Code on this server</h3>
    <p class="m-0 text-[12.5px] text-ink-2">
      The assistant runs Claude Code. Claude Code shows a link to sign in with your own Claude
      account, then asks for the code that page gives you. Claude Code keeps your sign-in in your
      own folder on this server. The server’s owner can read that folder.
    </p>
    <div v-if="!a.loginRunning.value" class="flex flex-wrap gap-1.5">
      <Button variant="primary" size="sm" @click="a.startLogin(false)"
        >Start Claude Code sign-in</Button
      >
      <Button size="sm" variant="quiet" @click="a.startLogin(true)"
        >Start Claude Code sign-in (Anthropic Console)</Button
      >
    </div>
    <template v-if="a.loginText.value">
      <p v-if="a.loginRunning.value" class="m-0 text-[12.5px] text-ink-2">
        Open the link Claude Code shows below, then paste the code that page gives you.
      </p>
      <pre
        aria-live="polite"
        aria-label="Claude Code’s sign-in"
        class="relative m-0 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md border border-line bg-raised p-2 font-mono text-[11.5px] text-ink"
      ><template v-for="(p, i) in pieces" :key="i"><a v-if="p.link" :href="p.text" target="_blank" rel="noopener noreferrer" class="text-gold-ink underline">{{ p.text }}</a><template v-else>{{ p.text }}</template></template></pre>
      <form v-if="a.loginRunning.value" class="flex flex-col gap-2" @submit.prevent="send">
        <Field label="Code for Claude Code">
          <Input v-model="code" autocomplete="off" spellcheck="false" />
        </Field>
        <div class="flex gap-1.5">
          <Button type="submit" size="sm" variant="primary" :disabled="!code || sending"
            >Send code</Button
          >
          <Button size="sm" variant="quiet" @click="a.cancelLogin()">Cancel</Button>
        </div>
      </form>
    </template>
    <p v-if="a.loginResult.value === 'failed'" role="alert" class="m-0 text-[12.5px] text-danger">
      The sign-in did not finish. Try again.
    </p>
  </section>
</template>
