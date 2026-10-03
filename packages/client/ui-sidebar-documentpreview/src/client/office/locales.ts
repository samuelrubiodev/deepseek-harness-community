/** Office preview copy and Host render configuration guidance. */
export const zh = {
  title: 'Office 文档',
  loading: '文档渲染中...',
  retry: '重试',
  viewMissingFonts: '缺失 {count} 种字体，点击查看',
  missingFontsTitle: '缺失的字体',
  missingFontsDescription: '本次预览无法使用以下字体，预览中的文字和排版可能与原文档不同。',
  missingFontsCount: '{count} 种字体',
  closeDetails: '关闭字体详情',
  unavailable: 'Office 预览不可用。请在运行 DeepSeek Harness 的主机上启用文档预览服务。',
  invalid: '无法预览此 Office 文件。文件可能已损坏、受密码保护，或与扩展名不符。',
  tooLarge: 'Office 文件或转换后的 PDF 超过预览大小上限，请缩小文件或调整预览配置。',
  failed: 'Office 转换失败，未生成可用的 PDF。请检查该文件后重试。',
  timeout: 'Office 转换超时，请重试。',
  busy: 'Office 预览任务较多，请稍后重试。',
  changed: '文件在读取时已更改，请重新打开预览。',
} satisfies Record<string, string>

/** Office preview locale keys. */
export type OfficePreviewKey = keyof typeof zh

/** English translations checked against the Chinese key set. */
export const en = {
  title: 'Office document',
  loading: 'Rendering document...',
  retry: 'Retry',
  viewMissingFonts: 'Missing fonts: {count}. Click to view.',
  missingFontsTitle: 'Missing fonts',
  missingFontsDescription: 'These fonts are unavailable for this preview. Text and layout may differ from the original document.',
  missingFontsCount: 'Fonts: {count}',
  closeDetails: 'Close font details',
  unavailable: 'Office previews are unavailable. Enable the document preview service on the computer running DeepSeek Harness.',
  invalid: 'This Office file cannot be previewed. It may be damaged, password protected, or have the wrong extension.',
  tooLarge: 'The Office file or converted PDF exceeds the preview size limit. Reduce the file size or adjust the preview configuration.',
  failed: 'Office conversion did not produce a usable PDF. Check the file and try again.',
  timeout: 'Office conversion timed out. Try again.',
  busy: 'Office preview is busy. Try again shortly.',
  changed: 'The file changed while being read. Reopen the preview.',
} satisfies Record<OfficePreviewKey, string>

/** Spanish translations checked against the Chinese key set. */
export const es = {
  title: 'Documento de Office',
  loading: 'Renderizando documento...',
  retry: 'Reintentar',
  viewMissingFonts: 'Faltan {count} fuentes. Haz clic para verlas.',
  missingFontsTitle: 'Fuentes ausentes',
  missingFontsDescription: 'Estas fuentes no están disponibles para esta vista previa. El texto y el diseño pueden diferir del documento original.',
  missingFontsCount: 'Fuentes: {count}',
  closeDetails: 'Cerrar detalles de fuentes',
  unavailable: 'Las vistas previas de Office no están disponibles. Habilita el servicio de vista previa de documentos en el host que ejecuta DeepSeek Harness.',
  invalid: 'No se puede previsualizar este archivo de Office. Puede estar dañado, protegido con contraseña o tener una extensión incorrecta.',
  tooLarge: 'El archivo de Office o el PDF convertido supera el límite de tamaño. Reduce el tamaño del archivo o ajusta la configuración.',
  failed: 'La conversión de Office no generó un PDF utilizable. Comprueba el archivo y vuelve a intentarlo.',
  timeout: 'Se agotó el tiempo de espera de conversión de Office. Inténtalo de nuevo.',
  busy: 'La vista previa de Office está ocupada. Vuelve a intentarlo en breve.',
  changed: 'El archivo cambió mientras se leía. Vuelve a abrir la vista previa.',
} satisfies Record<OfficePreviewKey, string>
