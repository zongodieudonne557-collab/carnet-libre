// Lecteur à voix haute : précédent, lecture / pause, suivant, vitesse. Sert à la causerie, aux sources et aux diapos.
// Les voix viennent du navigateur ; rien n'est envoyé par Carnet Libre (voir « Lecture à voix haute » dans la page Confidentialité).
import { getSettings } from '../settings.js';
import { createReader, frenchVoices, hostVoices, loadVoices, speechSupported } from '../tts/speech.js';
import { h, icon, mount, toast } from './dom.js';
import { href } from './router.js';

const RATES = [0.8, 1, 1.2, 1.5];
const fmtRate = (r) => `${String(r).replace('.', ',')}×`;

/**
 * @param {object} o
 * @param {(i: number) => void} [o.onSegment]  un nouveau segment commence (surligner, changer de diapo…)
 * @param {(state: 'idle'|'playing'|'paused') => void} [o.onState]
 * @param {(fn: () => void) => void} o.onCleanup  la lecture s'arrête quand on quitte l'écran
 * @param {boolean} [o.compact]  sans boutons précédent / suivant (l'écran a les siens)
 */
export async function createAudioPlayer({ onSegment, onState, onCleanup, compact = false }) {
  const supported = speechSupported();
  const voices = supported ? await loadVoices() : [];
  const tts = getSettings().tts;
  const hosts = hostVoices(voices, tts);
  const hasFrench = frenchVoices(voices).length > 0;
  let current = 0;
  let total = 0;
  let rate = RATES.includes(tts.rate) ? tts.rate : 1;

  const reader = supported
    ? createReader({
        onSegment: (i) => {
          current = i;
          paint();
          onSegment?.(i);
        },
        onEnd: () => paint(),
        onState: (s) => {
          paint();
          onState?.(s);
        },
        onError: (m) => toast(m, { kind: 'error' }),
      })
    : null;
  reader?.setRate(rate);
  onCleanup(() => reader?.destroy());

  const status = h('span.player-status.small', { 'aria-live': 'off' });
  const playBtn = h('button.btn.btn-primary.btn-lg.player-play', { type: 'button', onclick: toggle });
  const prevBtn = h('button.btn.btn-icon', { type: 'button', 'aria-label': 'Passage précédent', title: 'Précédent', onclick: () => reader?.prev() }, icon('skip-back', { size: 20 }));
  const nextBtn = h('button.btn.btn-icon', { type: 'button', 'aria-label': 'Passage suivant', title: 'Suivant', onclick: () => reader?.next() }, icon('skip-forward', { size: 20 }));
  const rateSel = h(
    'select.player-rate',
    {
      'aria-label': 'Vitesse de lecture',
      value: String(rate),
      onchange: (e) => {
        rate = Number(e.target.value);
        reader?.setRate(rate);
      },
    },
    RATES.map((r) => h('option', { value: String(r) }, fmtRate(r)))
  );

  let startAt = 0;
  function toggle() {
    if (!reader) return;
    if (reader.state === 'playing') reader.pause();
    else if (reader.state === 'paused') reader.resume();
    else reader.play(startAt);
  }

  function paint() {
    const st = reader?.state ?? 'idle';
    mount(playBtn, icon(st === 'playing' ? 'pause' : 'play', { size: 22 }), st === 'playing' ? 'Pause' : st === 'paused' ? 'Reprendre' : 'Écouter');
    prevBtn.disabled = nextBtn.disabled = st === 'idle';
    playBtn.disabled = !total;
    status.textContent = total ? `${Math.min(current + 1, total)} / ${total}` : '';
  }

  const el = h(
    'div.player',
    { role: 'group', 'aria-label': 'Lecteur audio' },
    supported ? [compact ? null : prevBtn, playBtn, compact ? null : nextBtn, status, h('label.visually-hidden', { for: 'player-rate' }, 'Vitesse de lecture'), rateSel] : null
  );
  rateSel.id = 'player-rate';

  /** Notice à afficher au-dessus du lecteur quand la lecture n'est pas possible ou demande un choix. */
  function notice() {
    if (!supported) return h('div.callout.callout-warn', icon('triangle-alert'), h('div', h('p', 'Ce navigateur ne sait pas lire à voix haute : tu peux lire le texte ci-dessous. Essaie Chrome, Edge, Firefox ou Safari récents pour écouter.')));
    if (!hasFrench) {
      return h(
        'div.callout.callout-warn',
        icon('triangle-alert'),
        h('div', h('p', h('strong', 'Aucune voix française sur cet appareil. '), 'La lecture utilisera une autre langue. Installe une voix française dans les paramètres de ton système, puis recharge la page. ', h('a', { href: href('/reglages') }, 'Plus d’infos dans les Réglages'), '.'))
      );
    }
    return null;
  }

  /** Avertit si une voix utilisée est « en ligne » (le navigateur envoie alors le texte à son fournisseur). */
  function onlineWarning(segments) {
    const online = segments.some((s) => s.voice && s.voice.localService === false);
    return online
      ? h('div.callout.callout-warn', icon('cloud'), h('div', h('p', 'Une des voix utilisées est « en ligne » : pour la lire, ton navigateur envoie le texte à son fournisseur (par exemple à Google dans Chrome). Choisis une voix « sur l’appareil » dans les ', h('a', { href: href('/reglages') }, 'Réglages'), ' pour que rien ne sorte.')))
      : null;
  }

  return {
    el,
    supported,
    voices,
    hosts,
    notice,
    onlineWarning,
    /** Segment pour une seule voix (lecture des sources, diapos) : la voix d'Awa. */
    single: (text) => ({ text, voice: hosts.a.voice, pitch: hosts.a.pitch === 1 ? undefined : 1 }),
    /** Segment pour un animateur : 'A' (Awa) ou 'B' (Issa). */
    host: (who, text) => {
      const v = who === 'B' ? hosts.b : hosts.a;
      return { text, voice: v.voice, pitch: v.pitch === 1 ? undefined : v.pitch };
    },
    load(segments) {
      reader?.load(segments);
      total = segments.length;
      current = 0;
      startAt = 0;
      paint();
    },
    /** Lit à partir d'un segment (clic sur une ligne de la transcription). */
    playFrom(i) {
      startAt = i;
      reader?.play(i);
    },
    /** Choisit le segment de départ sans lancer la lecture. */
    setStart(i) {
      startAt = i;
      current = i;
      paint();
    },
    toggle,
    stop: () => reader?.stop(),
    get state() {
      return reader?.state ?? 'idle';
    },
  };
}
