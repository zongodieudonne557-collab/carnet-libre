// Extraction de JSON dans la réponse d'un modèle de langage.
// Les petits modèles gratuits entourent souvent le JSON de texte, de ```json … ``` ou de balises
// de réflexion, ajoutent une virgule de trop, ou s'arrêtent en plein milieu (limite de longueur).
// On répare ce qui peut l'être et on indique ce qui a été réparé.

export class JSONError extends Error {
  constructor(message) {
    super(message);
    this.name = 'JSONError';
  }
}

function stripNoise(text) {
  let s = String(text ?? '');
  // balises de réflexion de certains modèles
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '');
  s = s.replace(/<think>[\s\S]*$/i, ''); // réflexion jamais refermée
  // clôtures de code
  s = s.replace(/```(?:json|JSON)?\s*/g, '').replace(/```/g, '');
  return s.trim();
}

/**
 * Passe unique : échappe les retours à la ligne dans les chaînes, retire les virgules de fin,
 * supprime les commentaires, et — si le texte est tronqué — ferme chaînes et crochets ouverts.
 * @returns {{text: string, truncated: boolean}}
 */
function repair(s) {
  let out = '';
  const stack = [];
  let inStr = false;
  let esc = false;
  let truncated = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) {
        esc = false;
        out += ch;
      } else if (ch === '\\') {
        esc = true;
        out += ch;
      } else if (ch === '"') {
        inStr = false;
        out += ch;
      } else if (ch === '\n') out += '\\n';
      else if (ch === '\r') out += '\\r';
      else if (ch === '\t') out += '\\t';
      else out += ch;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      out += ch;
    } else if (ch === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') i++;
    } else if (ch === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2);
      i = end < 0 ? s.length : end + 1;
    } else if (ch === '{' || ch === '[') {
      stack.push(ch === '{' ? '}' : ']');
      out += ch;
    } else if (ch === '}' || ch === ']') {
      out = out.replace(/,\s*$/, '');
      if (stack.length && stack[stack.length - 1] === ch) stack.pop();
      out += ch;
      if (!stack.length) return { text: out, truncated: false, consumed: i + 1 };
    } else {
      out += ch;
    }
  }
  // Fin de texte atteinte avec des structures ouvertes : le modèle a été coupé.
  truncated = stack.length > 0 || inStr;
  if (inStr) out += '"';
  out = out.replace(/,\s*$/, '');
  return { text: out, truncated, consumed: s.length };
}

/** Ferme proprement un JSON coupé : retire la fin incomplète puis ajoute les fermetures. */
function closeTruncated(text) {
  // Recalcule la pile sur le texte déjà réparé (chaînes fermées).
  const scan = (t) => {
    const stack = [];
    let inStr = false;
    let esc = false;
    let lastSafe = -1; // dernier indice d'une virgule hors chaîne
    const safe = [];
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') stack.push('}');
      else if (ch === '[') stack.push(']');
      else if (ch === '}' || ch === ']') stack.pop();
      else if (ch === ',') {
        lastSafe = i;
        safe.push({ i, depth: stack.length });
      }
    }
    return { stack, lastSafe, safe };
  };
  let t = text;
  for (let attempt = 0; attempt < 40; attempt++) {
    const { stack, lastSafe } = scan(t);
    const candidate = t.replace(/[,:]\s*$/, '') + stack.slice().reverse().join('');
    try {
      return JSON.parse(candidate);
    } catch {
      if (lastSafe < 0) break;
      t = t.slice(0, lastSafe); // on abandonne le dernier élément incomplet
    }
  }
  return undefined;
}

/** Tente de lire un bloc JSON qui commence au début de `body`. */
function tryParseAt(body) {
  // 1) tel quel
  const end = balancedEnd(body);
  if (end > 0) {
    try {
      return { value: JSON.parse(body.slice(0, end)), repaired: false, truncated: false, consumed: end };
    } catch {
      /* réparation */
    }
  }
  // 2) réparation (virgules, commentaires, retours à la ligne), puis 3) fermeture d'un texte tronqué
  const { text, truncated, consumed } = repair(body);
  try {
    return { value: JSON.parse(text), repaired: true, truncated, consumed };
  } catch {
    /* tronqué ? */
  }
  const closed = closeTruncated(text);
  if (closed !== undefined) return { value: closed, repaired: true, truncated: true, consumed: body.length };
  return null;
}

const isExpected = (v, expect) => (expect === 'array' ? Array.isArray(v) : expect === 'object' ? !Array.isArray(v) : true);

/**
 * Lit le premier JSON exploitable d'une réponse de modèle.
 * Essaie chaque « { » ou « [ » dans l'ordre (le texte autour peut contenir des crochets),
 * en ignorant ceux déjà contenus dans un JSON lu.
 * @param {string} raw Réponse brute du modèle
 * @param {{expect?: 'object'|'array'}} [opts] type préféré, s'il existe plusieurs blocs
 * @returns {{value: any, repaired: boolean, truncated: boolean}}
 */
export function parseModelJSON(raw, opts = {}) {
  const cleaned = stripNoise(raw);
  if (!/[{[]/.test(cleaned)) throw new JSONError('Aucun JSON trouvé dans la réponse du modèle.');
  let firstOk = null;
  let skipUntil = 0;
  let tried = 0;
  for (let i = 0; i < cleaned.length && tried < 12; i++) {
    const ch = cleaned[i];
    if ((ch !== '{' && ch !== '[') || i < skipUntil) continue;
    tried++;
    const r = tryParseAt(cleaned.slice(i));
    if (!r || typeof r.value !== 'object' || r.value === null) continue;
    skipUntil = i + r.consumed;
    if (isExpected(r.value, opts.expect)) return { value: r.value, repaired: r.repaired, truncated: r.truncated };
    if (!firstOk) firstOk = r;
  }
  if (firstOk) return { value: firstOk.value, repaired: firstOk.repaired, truncated: firstOk.truncated };
  throw new JSONError('La réponse du modèle n’est pas un JSON valide.');
}

/** Indice (exclu) de la fin du premier bloc JSON équilibré, ou -1. */
function balancedEnd(s) {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}
