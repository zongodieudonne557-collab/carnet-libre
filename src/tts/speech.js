// Lecture à voix haute avec les voix du navigateur (API Web Speech).
// Rien n'est envoyé par Carnet Libre : c'est le navigateur qui parle. Attention cependant :
// certaines voix sont « en ligne » (par exemple celles de Google dans Chrome) et le navigateur
// envoie alors le texte à son fournisseur. On les signale (`voice.localService === false`) et on
// préfère toujours une voix installée sur l'appareil.

// ------------------------------------------------------------------ voix

export const speechSupported = () => typeof globalThis.speechSynthesis !== 'undefined' && typeof globalThis.SpeechSynthesisUtterance !== 'undefined';

/** Charge la liste des voix (certains navigateurs la remplissent après coup). */
export function loadVoices({ synth = globalThis.speechSynthesis, timeout = 1500 } = {}) {
  return new Promise((resolve) => {
    if (!synth) return resolve([]);
    const now = synth.getVoices?.() || [];
    if (now.length) return resolve(now);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      synth.removeEventListener?.('voiceschanged', finish);
      resolve(synth.getVoices?.() || []);
    };
    synth.addEventListener?.('voiceschanged', finish);
    setTimeout(finish, timeout);
  });
}

const isFrench = (v) => /^fr([-_]|$)/i.test(v.lang || '');

/** Voix françaises, celles de l'appareil d'abord (jamais envoyées en ligne), puis par nom. */
export function frenchVoices(voices) {
  return (voices || [])
    .filter(isFrench)
    .slice()
    .sort((a, b) => Number(b.localService) - Number(a.localService) || (a.name || '').localeCompare(b.name || '', 'fr'));
}

/** Deux voix différentes pour la causerie (la même, si l'appareil n'en a qu'une). */
export function defaultVoices(voices) {
  const fr = frenchVoices(voices);
  const pool = fr.some((v) => v.localService) ? fr.filter((v) => v.localService) : fr;
  const a = pool[0] || null;
  const b = pool.find((v) => v !== a && v.name !== a?.name) || a;
  return { a, b };
}

export const findVoice = (voices, uri) => (uri ? (voices || []).find((v) => v.voiceURI === uri) || null : null);

// ------------------------------------------------------------------ LaTeX → texte parlé (français)

const GREEK = {
  alpha: 'alpha', beta: 'bêta', gamma: 'gamma', delta: 'delta', epsilon: 'epsilon', varepsilon: 'epsilon', zeta: 'dzêta', eta: 'êta', theta: 'thêta', vartheta: 'thêta',
  iota: 'iota', kappa: 'kappa', lambda: 'lambda', mu: 'mu', nu: 'nu', xi: 'ksi', pi: 'pi', rho: 'rho', sigma: 'sigma', tau: 'tau', upsilon: 'upsilon', phi: 'phi',
  varphi: 'phi', chi: 'khi', psi: 'psi', omega: 'oméga', Gamma: 'gamma majuscule', Delta: 'delta majuscule', Theta: 'thêta majuscule', Lambda: 'lambda majuscule',
  Pi: 'pi majuscule', Sigma: 'sigma majuscule', Phi: 'phi majuscule', Psi: 'psi majuscule', Omega: 'oméga majuscule',
};

const WORDS = {
  infty: 'l’infini', pm: 'plus ou moins', mp: 'moins ou plus', times: 'fois', cdot: 'fois', ast: 'étoile', div: 'divisé par', neq: 'différent de', ne: 'différent de',
  leq: 'inférieur ou égal à', le: 'inférieur ou égal à', leqslant: 'inférieur ou égal à', geq: 'supérieur ou égal à', ge: 'supérieur ou égal à', geqslant: 'supérieur ou égal à',
  ll: 'très inférieur à', gg: 'très supérieur à', approx: 'environ égal à', sim: 'équivalent à', equiv: 'équivaut à', cong: 'congru à', propto: 'proportionnel à',
  in: 'appartient à', notin: 'n’appartient pas à', ni: 'contient', subset: 'inclus dans', subseteq: 'inclus ou égal à', supset: 'contient', cup: 'union', cap: 'inter',
  emptyset: 'ensemble vide', varnothing: 'ensemble vide', forall: 'pour tout', exists: 'il existe', nexists: 'il n’existe pas', neg: 'non', lnot: 'non', land: 'et', wedge: 'et', lor: 'ou', vee: 'ou',
  Rightarrow: 'implique', implies: 'implique', Leftarrow: 'est impliqué par', Leftrightarrow: 'équivaut à', iff: 'si et seulement si', rightarrow: 'vers', to: 'vers', mapsto: 'associe',
  leftarrow: 'depuis', longrightarrow: 'vers', partial: 'd rond', nabla: 'nabla', circ: 'rond', perp: 'perpendiculaire à', parallel: 'parallèle à', angle: 'angle', degree: 'degrés',
  ldots: 'et ainsi de suite', cdots: 'et ainsi de suite', dots: 'et ainsi de suite', vdots: 'et ainsi de suite', therefore: 'donc', because: 'car', setminus: 'privé de', mid: 'divise',
  ln: 'logarithme népérien de', log: 'logarithme de', exp: 'exponentielle de', sin: 'sinus de', cos: 'cosinus de', tan: 'tangente de', arcsin: 'arc sinus de', arccos: 'arc cosinus de',
  arctan: 'arc tangente de', sinh: 'sinus hyperbolique de', cosh: 'cosinus hyperbolique de', tanh: 'tangente hyperbolique de', max: 'maximum de', min: 'minimum de', det: 'déterminant de',
  dim: 'dimension de', ker: 'noyau de', Im: 'image de', Re: 'partie réelle de', gcd: 'PGCD de', deg: 'degré de', mod: 'modulo', bmod: 'modulo', pmod: 'modulo', cos_: 'cosinus',
};

const SETS = { R: 'grand R', N: 'grand N', Z: 'grand Z', Q: 'grand Q', C: 'grand C', K: 'grand K', P: 'grand P', E: 'grand E' };
const DROP = new Set(['left', 'right', 'displaystyle', 'textstyle', 'scriptstyle', 'quad', 'qquad', ',', ';', ':', '!', ' ', 'big', 'Big', 'bigg', 'Bigg', 'limits', 'nolimits', 'mathstrut', 'strut', 'hfill', 'hspace', 'vspace', 'bigl', 'bigr', 'Bigl', 'Bigr']);
const WRAP = new Set(['mathrm', 'mathit', 'mathbf', 'mathsf', 'mathcal', 'mathscr', 'mathfrak', 'text', 'textbf', 'textit', 'textrm', 'operatorname', 'boldsymbol', 'bm', 'mbox', 'underline']);

function readGroup(s, i) {
  // s[i] === '{' : renvoie le contenu jusqu'à l'accolade fermante correspondante
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '\\') j++;
    else if (s[j] === '{') depth++;
    else if (s[j] === '}' && --depth === 0) return { text: s.slice(i + 1, j), next: j + 1 };
  }
  return { text: s.slice(i + 1), next: s.length };
}

function readArg(s, i) {
  while (s[i] === ' ') i++;
  if (i >= s.length) return { text: '', next: i };
  if (s[i] === '{') return readGroup(s, i);
  if (s[i] === '\\') {
    const m = /^\\([a-zA-Z]+|.)/.exec(s.slice(i));
    return { text: m[0], next: i + m[0].length };
  }
  return { text: s[i], next: i + 1 };
}

const squash = (t) => t.replace(/\s+/g, ' ').trim();
const isSimple = (t) => squash(t).split(' ').length <= 2;

function conv(s, ctx = {}) {
  let out = '';
  let i = 0;
  const push = (t) => {
    if (!t) return;
    out += (out && !/\s$/.test(out) && !/^[\s,.;:)]/.test(t) ? ' ' : '') + t;
  };
  let prevSet = false;

  while (i < s.length) {
    const c = s[i];
    if (c === '\\') {
      const m = /^\\([a-zA-Z]+|.)/.exec(s.slice(i));
      const name = m[1];
      i += m[0].length;
      if (name === '\\') {
        push(',');
      } else if (DROP.has(name)) {
        /* mise en page : ne se prononce pas */
      } else if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
        const a = readArg(s, i);
        const b = readArg(s, a.next);
        i = b.next;
        const num = conv(a.text, ctx);
        const den = conv(b.text, ctx);
        if (isSimple(num) && isSimple(den)) push(`${num} sur ${den}`);
        else push(`, la fraction ${num}, sur ${den}, fin de fraction,`);
      } else if (name === 'binom') {
        const a = readArg(s, i);
        const b = readArg(s, a.next);
        i = b.next;
        push(`${conv(b.text, ctx)} parmi ${conv(a.text, ctx)}`);
      } else if (name === 'sqrt') {
        let idx = '';
        if (s[i] === '[') {
          const end = s.indexOf(']', i);
          idx = squash(s.slice(i + 1, end < 0 ? s.length : end));
          i = end < 0 ? s.length : end + 1;
        }
        const a = readArg(s, i);
        i = a.next;
        const inner = conv(a.text, ctx);
        const word = idx === '3' ? 'racine cubique' : idx && idx !== '2' ? `racine ${conv(idx, ctx)}-ième` : 'racine carrée';
        push(isSimple(inner) ? `${word} de ${inner}` : `${word} de, ${inner}, fin de racine,`);
      } else if (name === 'sum' || name === 'prod' || name === 'int' || name === 'iint' || name === 'oint' || name === 'lim' || name === 'limsup' || name === 'liminf' || name === 'bigcup' || name === 'bigcap') {
        let low = '';
        let up = '';
        for (let k = 0; k < 2; k++) {
          while (s[i] === ' ') i++;
          if (s[i] === '_') {
            const a = readArg(s, i + 1);
            low = a.text;
            i = a.next;
          } else if (s[i] === '^') {
            const a = readArg(s, i + 1);
            up = a.text;
            i = a.next;
          }
        }
        const L = conv(low, { ...ctx, inLim: name.startsWith('lim') });
        const U = conv(up, ctx);
        if (name === 'sum' || name === 'prod') {
          const word = name === 'sum' ? 'somme' : 'produit';
          push(L ? `${word} pour ${L}${U ? ` jusqu’à ${U}` : ''} de` : `${word} de`);
        } else if (name === 'int' || name === 'iint' || name === 'oint') {
          const word = name === 'int' ? 'intégrale' : name === 'iint' ? 'intégrale double' : 'intégrale curviligne';
          push(L || U ? `${word} de ${L}${U ? ` à ${U}` : ''}, de` : `${word} de`);
        } else if (name === 'bigcup' || name === 'bigcap') {
          push(`${name === 'bigcup' ? 'union' : 'intersection'}${L ? ` pour ${L}` : ''} de`);
        } else {
          push(L ? `limite quand ${L}, de` : 'limite de');
        }
      } else if (name === 'vec' || name === 'overrightarrow') {
        const a = readArg(s, i);
        i = a.next;
        push(`vecteur ${conv(a.text, ctx).replace(/(?<=\S)(?=\S)/g, ' ').replace(/\s+/g, ' ')}`);
      } else if (name === 'bar' || name === 'overline') {
        const a = readArg(s, i);
        i = a.next;
        push(`${conv(a.text, ctx)} barre`);
      } else if (name === 'hat' || name === 'widehat') {
        const a = readArg(s, i);
        i = a.next;
        push(`${conv(a.text, ctx)} chapeau`);
      } else if (name === 'tilde' || name === 'widetilde') {
        const a = readArg(s, i);
        i = a.next;
        push(`${conv(a.text, ctx)} tilde`);
      } else if (name === 'dot') {
        const a = readArg(s, i);
        i = a.next;
        push(`${conv(a.text, ctx)} point`);
      } else if (name === 'mathbb') {
        const a = readArg(s, i);
        i = a.next;
        const t = a.text.trim();
        push(SETS[t] || t);
        prevSet = true;
        continue;
      } else if (WRAP.has(name)) {
        const a = readArg(s, i);
        i = a.next;
        push(conv(a.text, ctx));
      } else if (name === 'to' || name === 'rightarrow' || name === 'longrightarrow') {
        push(ctx.inLim ? 'tend vers' : 'vers');
      } else if (name === 'mathbf' || name === 'not') {
        /* ignoré */
      } else if (name === 'lvert' || name === 'rvert' || name === 'vert' || name === '|' || name === 'lVert' || name === 'rVert' || name === 'Vert') {
        push('barre');
      } else if (name === 'langle') {
        push('crochet gauche');
      } else if (name === 'rangle') {
        push('crochet droit');
      } else if (name === '%') {
        push('pour cent');
      } else if (name === '{' || name === '}') {
        push(name === '{' ? 'accolade ouvrante' : 'accolade fermante');
      } else if (name === '&' || name === '$' || name === '#' || name === '_') {
        push(name === '&' ? 'et' : name);
      } else if (GREEK[name]) {
        push(GREEK[name]);
      } else if (WORDS[name]) {
        push(WORDS[name]);
      } else {
        push(name); // commande inconnue : on dit son nom plutôt que de se taire
      }
    } else if (c === '^' || c === '_') {
      const a = readArg(s, i + 1);
      i = a.next;
      const inner = conv(a.text, ctx);
      if (c === '^') {
        const t = squash(a.text);
        if (!prevSet && t === '2') push('au carré');
        else if (!prevSet && t === '3') push('au cube');
        else if (prevSet) push(inner);
        else if (t === '\\prime' || t === '\\prime\\prime' || t === '′') push(t === '\\prime' || t === '′' ? 'prime' : 'seconde');
        else if (isSimple(inner)) push(`puissance ${inner}`);
        else push(`puissance, ${inner}, fin de puissance,`);
      } else if (isSimple(inner)) push(`indice ${inner}`);
      else push(`indice, ${inner}, fin d’indice,`);
    } else if (c === '{' || c === '}') {
      i++;
    } else if (c === '=') {
      push('égale');
      i++;
    } else if (c === '+') {
      push('plus');
      i++;
    } else if (c === '-' || c === '−') {
      push('moins');
      i++;
    } else if (c === '<') {
      push('inférieur à');
      i++;
    } else if (c === '>') {
      push('supérieur à');
      i++;
    } else if (c === '/') {
      push('sur');
      i++;
    } else if (c === '|') {
      push('barre');
      i++;
    } else if (c === '!') {
      push('factorielle');
      i++;
    } else if (c === "'") {
      push('prime');
      i++;
    } else if (c === '%') {
      push('pour cent');
      i++;
    } else if (c === '(' || c === ')' || c === '[' || c === ']') {
      // « f(x) » se lit « f de x » ; les autres parenthèses ne se prononcent pas, mais marquent une pause
      if (c === '(' && /(?:^|[^a-zA-Z\\])[fghFGHuvPQ]$/.test(out) && !/\s$/.test(out)) push('de');
      else if (c === '(' || c === '[') push(',');
      else push(',');
      i++;
    } else if (/\s/.test(c)) {
      out += ' ';
      i++;
    } else {
      // lettres, chiffres, ponctuation : tels quels (la virgule décimale française est conservée)
      let j = i;
      while (j < s.length && !/[\\^_{}=+\-−<>/|!'%()[\]\s]/.test(s[j])) j++;
      if (j === i) j = i + 1;
      push(s.slice(i, j));
      i = j;
    }
    prevSet = false;
  }
  return squash(out).replace(/\s+([,.;:])/g, '$1').replace(/,{2,}/g, ',');
}

/** « \frac{a+1}{b} » → « fraction a plus 1, sur b » : une formule dite à voix haute, en français. */
export function texToSpeech(tex) {
  try {
    return conv(String(tex ?? '')).replace(/^[,\s]+|[,\s]+$/g, '');
  } catch {
    return String(tex ?? '');
  }
}

const UNICODE_SPEECH = [
  [/²/g, ' au carré '], [/³/g, ' au cube '], [/√/g, ' racine carrée de '], [/π/g, ' pi '], [/≤/g, ' inférieur ou égal à '], [/≥/g, ' supérieur ou égal à '], [/≠/g, ' différent de '],
  [/≈/g, ' environ égal à '], [/∞/g, ' l’infini '], [/→/g, ' vers '], [/⇒/g, ' implique '], [/⇔/g, ' équivaut à '], [/×/g, ' fois '], [/÷/g, ' divisé par '], [/±/g, ' plus ou moins '],
  [/∈/g, ' appartient à '], [/∉/g, ' n’appartient pas à '], [/∀/g, ' pour tout '], [/∃/g, ' il existe '], [/∑/g, ' somme '], [/∫/g, ' intégrale '], [/∪/g, ' union '], [/∩/g, ' inter '],
  [/°C/g, ' degrés Celsius '], [/°/g, ' degrés '], [/∆|Δ/g, ' delta '], [/α/g, ' alpha '], [/β/g, ' bêta '], [/λ/g, ' lambda '], [/μ/g, ' mu '], [/θ/g, ' thêta '], [/σ/g, ' sigma '], [/ω/g, ' oméga '],
];

/**
 * Prépare un texte (Markdown, citations, formules) pour la synthèse vocale :
 * enlève la mise en forme, les numéros de citation et les liens, dit les formules.
 */
export function prepareSpeech(raw) {
  let t = String(raw ?? '');
  t = t.replace(/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\$([^$\n]+?)\$|\\\(([\s\S]+?)\\\)/g, (_m, a, b, c, d) => ` ${texToSpeech(a ?? b ?? c ?? d)} `);
  t = t
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\((?:https?:|#)[^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+•]\s+/gm, '')
    .replace(/^\s*\d{1,2}[.)]\s+/gm, '')
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/(^|[\s(])[*_](?=\S)([^*_\n]*?\S)[*_](?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/(?:\[\d{1,3}\])+/g, '');
  for (const [re, word] of UNICODE_SPEECH) t = t.replace(re, word);
  return t
    .replace(/[|]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Découpe en phrases courtes (les moteurs de voix coupent ou bégaient sur les très longs textes). */
export function splitSentences(text, max = 220) {
  const out = [];
  const pieces = String(text ?? '')
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?…])\s+(?=[«"“(\p{Lu}\d])/u));
  for (let piece of pieces) {
    piece = piece.trim();
    if (!piece) continue;
    while (piece.length > max) {
      let cut = Math.max(piece.lastIndexOf(', ', max), piece.lastIndexOf('; ', max), piece.lastIndexOf(' : ', max));
      if (cut < max * 0.4) cut = piece.lastIndexOf(' ', max);
      if (cut < 20) cut = max;
      out.push(piece.slice(0, cut + 1).trim());
      piece = piece.slice(cut + 1).trim();
    }
    if (piece) out.push(piece);
  }
  return out.filter((s) => /[\p{L}\p{N}]/u.test(s));
}

// ------------------------------------------------------------------ lecteur

/**
 * Lecteur à file d'attente : lit des « segments » (un tour de parole, une diapo…) l'un après l'autre,
 * avec pause, reprise, saut en avant / en arrière et vitesse réglable.
 * La pause est une vraie interruption : la reprise relit la phrase en cours (fiable sur tous les navigateurs).
 *
 * @param {object} [o]
 * @param {(segIndex: number) => void} [o.onSegment]  un nouveau segment commence
 * @param {() => void} [o.onEnd]                        tout est lu
 * @param {(state: 'idle'|'playing'|'paused') => void} [o.onState]
 * @param {(message: string) => void} [o.onError]
 * @param {object} [o.synth]  (tests) moteur de synthèse
 * @param {Function} [o.Utterance]  (tests)
 */
export function createReader({ onSegment, onEnd, onState, onError, synth = globalThis.speechSynthesis, Utterance = globalThis.SpeechSynthesisUtterance } = {}) {
  /** @type {{text: string, voice?: any, pitch?: number, rate?: number, lang?: string}[]} */
  let segments = [];
  let units = []; // { seg, text }
  let firstUnit = []; // segIndex → premier indice d'unité
  let pos = 0;
  let state = 'idle';
  let gen = 0;
  let rate = 1;
  let failed = 0;
  let announced = -1; // dernier segment annoncé à l'interface

  const setState = (s) => {
    if (state === s) return;
    state = s;
    onState?.(s);
  };

  function build(list) {
    segments = list || [];
    units = [];
    firstUnit = [];
    segments.forEach((seg, si) => {
      firstUnit[si] = units.length;
      for (const text of splitSentences(prepareSpeech(seg.text))) units.push({ seg: si, text });
      if (firstUnit[si] === units.length) firstUnit[si] = -1; // segment sans rien à dire
    });
  }

  function speakUnit() {
    const myGen = ++gen;
    if (pos >= units.length) {
      setState('idle');
      pos = 0;
      onEnd?.();
      return;
    }
    const u = units[pos];
    const seg = segments[u.seg];
    if (u.seg !== announced) {
      announced = u.seg;
      onSegment?.(u.seg);
    }
    const ut = new Utterance(u.text);
    ut.lang = seg.lang || seg.voice?.lang || 'fr-FR';
    if (seg.voice) ut.voice = seg.voice;
    ut.rate = Math.min(2, Math.max(0.5, (seg.rate || 1) * rate));
    if (seg.pitch) ut.pitch = seg.pitch;
    ut.onend = () => {
      if (myGen !== gen) return;
      failed = 0;
      pos++;
      speakUnit();
    };
    ut.onerror = (e) => {
      if (myGen !== gen) return;
      if (e?.error === 'canceled' || e?.error === 'interrupted') return;
      // une voix qui échoue : on passe à la phrase suivante, et on abandonne après quelques échecs d'affilée
      if (++failed >= 3) {
        failed = 0;
        stop();
        onError?.('La lecture à voix haute a échoué. Essaie une autre voix dans les Réglages.');
        return;
      }
      pos++;
      speakUnit();
    };
    synth.speak(ut);
  }

  function play(fromSegment = 0) {
    if (!synth || !Utterance) {
      onError?.('Ce navigateur ne sait pas lire à voix haute.');
      return false;
    }
    if (!units.length) {
      onEnd?.();
      return false;
    }
    gen++;
    synth.cancel();
    announced = -1;
    let from = fromSegment;
    while (from < segments.length && firstUnit[from] === -1) from++;
    pos = from >= segments.length ? 0 : firstUnit[from];
    setState('playing');
    // Chrome ignore parfois un speak() lancé juste après cancel() : on laisse respirer le moteur
    setTimeout(speakUnit, 30);
    return true;
  }

  function stop() {
    gen++;
    synth?.cancel?.();
    pos = 0;
    announced = -1;
    setState('idle');
  }

  function pause() {
    if (state !== 'playing') return;
    gen++;
    synth.cancel();
    setState('paused');
  }

  function resume() {
    if (state !== 'paused') return;
    setState('playing');
    setTimeout(speakUnit, 30);
  }

  function jump(delta) {
    if (!units.length || state === 'idle') return;
    const cur = units[Math.min(pos, units.length - 1)].seg;
    let target = cur + delta;
    while (target >= 0 && target < segments.length && firstUnit[target] === -1) target += delta;
    if (target < 0) target = 0;
    if (target >= segments.length) return stop();
    const wasPaused = state === 'paused';
    gen++;
    synth.cancel();
    pos = firstUnit[target] >= 0 ? firstUnit[target] : pos;
    if (wasPaused) {
      // reste en pause, mais l'interface montre déjà le nouveau segment et la reprise partira de là
      announced = units[pos].seg;
      onSegment?.(announced);
      return;
    }
    announced = -1; // speakUnit() l'annoncera
    setState('playing');
    setTimeout(speakUnit, 30);
  }

  return {
    load: (list) => {
      stop();
      build(list);
    },
    play,
    pause,
    resume,
    stop,
    next: () => jump(1),
    prev: () => jump(-1),
    setRate(r) {
      rate = Math.min(2, Math.max(0.5, Number(r) || 1));
      if (state === 'playing') {
        // la nouvelle vitesse s'applique à la phrase suivante ; on relance la phrase en cours pour l'entendre tout de suite
        gen++;
        synth.cancel();
        setTimeout(speakUnit, 30);
      }
    },
    get state() {
      return state;
    },
    get segment() {
      return units.length ? units[Math.min(pos, units.length - 1)].seg : 0;
    },
    get length() {
      return segments.length;
    },
    destroy: stop,
  };
}

/** Lit une phrase d'essai avec une voix donnée (bouton « Écouter » des Réglages). */
export function sample(text, { voice, rate = 1, pitch, synth = globalThis.speechSynthesis, Utterance = globalThis.SpeechSynthesisUtterance } = {}) {
  if (!synth || !Utterance) return false;
  synth.cancel();
  const ut = new Utterance(text);
  ut.lang = voice?.lang || 'fr-FR';
  if (voice) ut.voice = voice;
  ut.rate = rate;
  if (pitch) ut.pitch = pitch;
  setTimeout(() => synth.speak(ut), 30);
  return true;
}
