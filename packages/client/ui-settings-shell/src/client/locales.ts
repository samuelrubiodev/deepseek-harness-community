/** Locale bundles for the shell executor's settings page. */

import type { SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'

/** Locale keys the page renders. */
export type ShellSettingsLocaleKey =
  | 'title' | 'description'
  | 'timeoutMs' | 'timeoutMsHint' | 'maxOutputBytes' | 'maxOutputBytesHint'
  | 'overridden' | 'reset' | 'readOnly' | 'unavailable'
  | 'save' | 'saving' | 'saveFailed' | 'invalidNumber'

/** English copy. */
export const en: Record<ShellSettingsLocaleKey, string> = {
  title: 'Shell',
  description: 'Limit how long each command may run and how much it may output.',
  timeoutMs: 'Command timeout (ms)',
  timeoutMsHint: 'How long one command may run before it is terminated.',
  maxOutputBytes: 'Output cap per stream (bytes)',
  maxOutputBytesHint: 'Output beyond this spills to a temporary file rather than being lost.',
  overridden: 'Overridden',
  reset: 'Reset to default',
  readOnly: 'This deployment stores settings read-only.',
  unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
  save: 'Save',
  saving: 'Saving…',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
  invalidNumber: 'Enter a number, or leave blank to use the default.',
}

/** Simplified Chinese copy. */
export const zh: Record<ShellSettingsLocaleKey, string> = {
  title: '终端',
  description: '限制每条命令最多能跑多久、最多输出多少内容。',
  timeoutMs: '命令超时（毫秒）',
  timeoutMsHint: '单条命令允许运行多久，超时即终止。',
  maxOutputBytes: '单流输出上限（字节）',
  maxOutputBytesHint: '超出部分会转存到临时文件，而不是被丢弃。',
  overridden: '已覆盖',
  reset: '恢复默认',
  readOnly: '本部署的设置为只读。',
  unavailable: '该插件当前未加载，暂时无法配置。',
  save: '保存',
  saving: '保存中…',
  saveFailed: '本部署没有接受这些值，已保留供你修改。',
  invalidNumber: '请填数字；留空表示使用默认值。',
}

/** Spanish copy. */
export const es: Record<ShellSettingsLocaleKey, string> = {
  title: 'Terminal',
  description: 'Limita cuánto tiempo puede ejecutarse cada comando y cuánto puede generar.',
  timeoutMs: 'Tiempo de espera del comando (ms)',
  timeoutMsHint: 'Cuánto tiempo puede ejecutarse un comando antes de ser finalizado.',
  maxOutputBytes: 'Límite de salida por flujo (bytes)',
  maxOutputBytesHint: 'La salida que supere este límite se transfiere a un archivo temporal en lugar de perderse.',
  overridden: 'Anulado',
  reset: 'Restablecer valores predeterminados',
  readOnly: 'Esta implementación almacena la configuración en modo de solo lectura.',
  unavailable: 'Este complemento no está cargado, por lo que no se puede configurar en este momento.',
  save: 'Guardar',
  saving: 'Guardando…',
  saveFailed: 'La implementación no aceptó estos valores; se han mantenido para que los corrijas.',
  invalidNumber: 'Ingresa un número o deja en blanco para usar el valor predeterminado.',
}


/**
 * The form frame's copy, read from this page's dictionary.
 * @param t - the page's locale reader.
 * @returns the labels the shared settings form renders.
 */
export function formLabels(t: (key: ShellSettingsLocaleKey) => string): SettingsFormLabels {
  return { unavailable: t('unavailable'), readOnly: t('readOnly'), saveFailed: t('saveFailed'), save: t('save'), saving: t('saving') }
}
