/** Locale bundles for the Subagent settings page. */

import type { SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'

/** Locale keys the page renders. */
export type SubagentSettingsLocaleKey =
  | 'overridden' | 'reset' | 'readOnly' | 'unavailable'
  | 'save' | 'saving' | 'saveFailed'
  | 'subagentTitle' | 'subagentDescription' | 'subagentLimitsTitle'
  | 'subagentMaxDepth'
  | 'subagentDepthHelpLabel' | 'subagentDepthHelp'
  | 'subagentDepthZero' | 'subagentDepthOne' | 'subagentDepthOverride'
  | 'subagentMaxActive'
  | 'subagentCapacityHelpLabel' | 'subagentCapacityHelp'
  | 'subagentDepthInvalid'
  | 'subagentCapacityInvalid'
  | 'subagentModelSelectionTitle'
  | 'subagentModelSelectionToggle' | 'subagentModelSelectionChoose' | 'subagentModelSelectionAllowed'
  | 'subagentModelSelectionLoading' | 'subagentModelSelectionLoadFailed' | 'subagentModelSelectionRetry'
  | 'subagentModelSelectionPartial' | 'subagentModelSelectionUnavailable'
  | 'subagentModelSelectionUnavailableGroup' | 'subagentModelSelectionEmpty'
  | 'subagentModelSelectionRequired' | 'subagentModelSelectionConflict' | 'subagentModelSelectionOff'

/** English copy. */
export const en: Record<SubagentSettingsLocaleKey, string> = {
  overridden: 'Overridden',
  reset: 'Reset to default',
  readOnly: 'This deployment stores settings read-only.',
  unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
  save: 'Save',
  saving: 'Saving…',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
  subagentTitle: 'Subagent',
  subagentDescription: 'Set Subagent recursion depth, count, and models.',
  subagentLimitsTitle: 'Limits',
  subagentMaxDepth: 'Maximum recursion depth',
  subagentDepthHelpLabel: 'About maximum recursion depth',
  subagentDepthHelp: 'Limits how many levels of Subagents an Agent can create.',
  subagentDepthZero: 'Disable Subagents',
  subagentDepthOne: 'Only the main Agent can create Subagents',
  subagentDepthOverride: 'If a tool defines its own maximum recursion depth, that setting takes precedence.',
  subagentMaxActive: 'Subagent parallelism limit',
  subagentCapacityHelpLabel: 'About the Subagent parallelism limit',
  subagentCapacityHelp: 'Total live Subagents under the same main Agent, across all recursion levels. The main Agent is excluded. New start requests are rejected when the limit is reached.',
  subagentDepthInvalid: 'Enter a whole number of 0 or more.',
  subagentCapacityInvalid: 'Enter a whole number of 1 or more.',
  subagentModelSelectionTitle: 'Model selection',
  subagentModelSelectionToggle: 'Allow agents to choose models for Subagents',
  subagentModelSelectionChoose: 'When enabled, agents can choose a provider, model, and reasoning effort for each Subagent from the authorized models below. Applies only to new sessions.',
  subagentModelSelectionAllowed: 'Models agents may choose',
  subagentModelSelectionLoading: 'Loading models…',
  subagentModelSelectionLoadFailed: 'Models could not be loaded.',
  subagentModelSelectionRetry: 'Retry',
  subagentModelSelectionPartial: 'Some model providers could not be loaded; saved choices remain removable.',
  subagentModelSelectionUnavailable: 'Currently unavailable',
  subagentModelSelectionUnavailableGroup: 'Saved but currently unavailable',
  subagentModelSelectionEmpty: 'No model provider currently advertises a model.',
  subagentModelSelectionRequired: 'Select at least one model before saving.',
  subagentModelSelectionConflict: 'Settings changed elsewhere. Discard your draft and try again.',
  subagentModelSelectionOff: 'Subagents use configured defaults or inherit the parent agent\'s model. Saved model choices are retained.',
}

/** Simplified Chinese copy. */
export const zh: Record<SubagentSettingsLocaleKey, string> = {
  overridden: '已覆盖',
  reset: '恢复默认',
  readOnly: '本部署的设置为只读。',
  unavailable: '该插件当前未加载，暂时无法配置。',
  save: '保存',
  saving: '保存中…',
  saveFailed: '本部署没有接受这些值，已保留供你修改。',
  subagentTitle: '子智能体',
  subagentDescription: '设置子智能体的递归层级、数量和模型。',
  subagentLimitsTitle: '运行限制',
  subagentMaxDepth: '最大递归深度',
  subagentDepthHelpLabel: '最大递归深度说明',
  subagentDepthHelp: '限制 Agent 创建子智能体的递归层级。',
  subagentDepthZero: '禁用子智能体',
  subagentDepthOne: '仅允许主 Agent 创建子智能体',
  subagentDepthOverride: '如果某个工具单独设置了最大递归深度，以该工具的设置为准。',
  subagentMaxActive: '子智能体并行数量上限',
  subagentCapacityHelpLabel: '子智能体并行数量上限说明',
  subagentCapacityHelp: '同一主 Agent 下，所有递归层级同时存活的子智能体总数，主 Agent 不计入。达到上限时，新的启动请求会被拒绝。',
  subagentDepthInvalid: '请输入不小于 0 的整数。',
  subagentCapacityInvalid: '请输入不小于 1 的整数。',
  subagentModelSelectionTitle: '模型选择',
  subagentModelSelectionToggle: '允许 Agent 为子智能体选择模型',
  subagentModelSelectionChoose: '开启后，Agent 可以从下方授权模型中，为每个子智能体选择提供方、模型和推理强度。仅影响新会话。',
  subagentModelSelectionAllowed: 'Agent 可选择的模型',
  subagentModelSelectionLoading: '正在加载模型…',
  subagentModelSelectionLoadFailed: '无法加载模型。',
  subagentModelSelectionRetry: '重试',
  subagentModelSelectionPartial: '部分模型提供方暂时无法加载；已保存的选择仍可移除。',
  subagentModelSelectionUnavailable: '当前不可用',
  subagentModelSelectionUnavailableGroup: '已保存但当前不可用',
  subagentModelSelectionEmpty: '当前没有模型提供方公布模型。',
  subagentModelSelectionRequired: '保存前请至少选择一个模型。',
  subagentModelSelectionConflict: '设置已在其他位置更新。请放弃修改后重试。',
  subagentModelSelectionOff: '关闭后，子智能体使用配置的默认模型或继承父 Agent 的模型；已选模型会保留。',
}

/** Spanish copy. */
export const es: Record<SubagentSettingsLocaleKey, string> = {
  overridden: 'Anulado',
  reset: 'Restablecer valores predeterminados',
  readOnly: 'Esta implementación almacena la configuración en modo de solo lectura.',
  unavailable: 'Este complemento no está cargado, por lo que no se puede configurar en este momento.',
  save: 'Guardar',
  saving: 'Guardando…',
  saveFailed: 'La implementación no aceptó estos valores; se han mantenido para que los corrijas.',
  subagentTitle: 'Subagente',
  subagentDescription: 'Configura la profundidad de recursión, el recuento y los modelos del subagente.',
  subagentLimitsTitle: 'Límites',
  subagentMaxDepth: 'Profundidad máxima de recursión',
  subagentDepthHelpLabel: 'Acerca de la profundidad máxima de recursión',
  subagentDepthHelp: 'Limita cuántos niveles de subagentes puede crear un agente.',
  subagentDepthZero: 'Desactivar subagentes',
  subagentDepthOne: 'Solo el agente principal puede crear subagentes',
  subagentDepthOverride: 'Si una herramienta define su propia profundidad máxima de recursión, esa configuración tiene prioridad.',
  subagentMaxActive: 'Límite de paralelismo de subagentes',
  subagentCapacityHelpLabel: 'Acerca del límite de paralelismo de subagentes',
  subagentCapacityHelp: 'Total de subagentes activos bajo el mismo agente principal, en todos los niveles de recursión. Se excluye el agente principal. Las nuevas solicitudes de inicio se rechazan al alcanzar el límite.',
  subagentDepthInvalid: 'Ingresa un número entero mayor o igual a 0.',
  subagentCapacityInvalid: 'Ingresa un número entero mayor o igual a 1.',
  subagentModelSelectionTitle: 'Selección de modelos',
  subagentModelSelectionToggle: 'Permitir que los agentes elijan modelos para los subagentes',
  subagentModelSelectionChoose: 'Cuando está habilitado, los agentes pueden elegir un proveedor, modelo y esfuerzo de razonamiento para cada subagente entre los modelos autorizados a continuación. Se aplica solo a nuevas sesiones.',
  subagentModelSelectionAllowed: 'Modelos que los agentes pueden elegir',
  subagentModelSelectionLoading: 'Cargando modelos…',
  subagentModelSelectionLoadFailed: 'No se pudieron cargar los modelos.',
  subagentModelSelectionRetry: 'Reintentar',
  subagentModelSelectionPartial: 'No se pudieron cargar algunos proveedores de modelos; las opciones guardadas aún se pueden eliminar.',
  subagentModelSelectionUnavailable: 'Actualmente no disponible',
  subagentModelSelectionUnavailableGroup: 'Guardado pero actualmente no disponible',
  subagentModelSelectionEmpty: 'Ningún proveedor de modelos anuncia un modelo actualmente.',
  subagentModelSelectionRequired: 'Selecciona al menos un modelo antes de guardar.',
  subagentModelSelectionConflict: 'La configuración cambió en otro lugar. Descarta el borrador e inténtalo de nuevo.',
  subagentModelSelectionOff: 'Los subagentes usan los valores predeterminados configurados o heredan el modelo del agente principal. Se conservan las opciones de modelos guardadas.',
}


/**
 * The form frame's copy, read from this page's dictionary.
 * @param t - the page's locale reader.
 * @returns the labels the shared settings form renders.
 */
export function formLabels(t: (key: SubagentSettingsLocaleKey) => string): SettingsFormLabels {
  return { unavailable: t('unavailable'), readOnly: t('readOnly'), saveFailed: t('saveFailed'), save: t('save'), saving: t('saving') }
}
