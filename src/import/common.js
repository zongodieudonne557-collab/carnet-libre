// Éléments communs aux importeurs : erreur lisible, annulation.

/** Erreur d'import dont le message est prêt à être montré à l'élève. */
export class ImportError extends Error {
  /**
   * @param {string} message phrase en français, avec la solution quand il y en a une
   * @param {string} [code] 'empty' | 'unsupported' | 'too_big' | 'ocr_off' | 'corrupt' | 'password' | 'failed'
   * @param {object} [extra] données utiles à l'interface (ex. pages à lire par OCR)
   */
  constructor(message, code = 'failed', extra = {}) {
    super(message);
    this.name = 'ImportError';
    this.code = code;
    Object.assign(this, extra);
  }
}

export function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException('Import annulé.', 'AbortError');
}

export const isAbort = (e) => e?.name === 'AbortError';
