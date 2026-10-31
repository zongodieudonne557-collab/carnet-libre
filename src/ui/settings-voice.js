// Réglages : lecture à voix haute (voix des deux animateurs de la causerie, vitesse).
import { getSettings, updateSettings } from '../settings.js';
import { defaultVoices, findVoice, frenchVoices, loadVoices, sample, speechSupported } from '../tts/speech.js';
import { h, icon, mount } from './dom.js';

const fmtRate = (r) => `${Number(r).toFixed(1).replace('.', ',')}×`;

const HOSTS = [
  { key: 'voiceA', id: 'tts-voice-a', name: 'Awa', text: 'Bonjour, je suis Awa. Aujourd’hui, nous allons réviser ton cours ensemble.' },
  { key: 'voiceB', id: 'tts-voice-b', name: 'Issa', text: 'Salut, moi c’est Issa. Je te propose de commencer par les idées principales.' },
];

export function voiceSection() {
  const root = h('div.voice');
  if (!speechSupported()) {
    mount(root, h('div.callout.callout-warn', icon('triangle-alert'), h('div', h('p', 'Ce navigateur ne sait pas lire à voix haute. Le reste de l’appli fonctionne ; essaie Chrome, Edge, Firefox ou Safari récents pour écouter tes cours.'))));
    return root;
  }
  mount(root, h('p.muted', 'Recherche des voix de cet appareil…'));
  let showAll = false;
  loadVoices().then((voices) => render(voices));

  function render(voices) {
    const tts = getSettings().tts;
    const fr = frenchVoices(voices);
    const pool = showAll ? [...voices].sort((a, b) => (a.lang || '').localeCompare(b.lang || '') || (a.name || '').localeCompare(b.name || '', 'fr')) : fr;
    const auto = defaultVoices(voices);
    const label = (v) => `${v.name}${showAll ? ` (${v.lang})` : ''} — ${v.localService ? 'sur l’appareil' : 'en ligne'}`;
    const chosen = (key) => findVoice(voices, getSettings().tts[key]) || (key === 'voiceA' ? auto.a : auto.b);

    const note = h('div.voice-note', { 'aria-live': 'polite' });
    const paintNote = () => {
      const online = HOSTS.map((x) => chosen(x.key)).filter((v) => v && !v.localService);
      mount(
        note,
        online.length
          ? h(
              'div.callout.callout-warn',
              icon('cloud'),
              h('div', h('p', 'Une des voix choisies est « en ligne » : pour la lire, ton navigateur envoie le texte à son fournisseur (par exemple à Google dans Chrome). Choisis une voix « sur l’appareil » pour que rien ne sorte.'))
            )
          : null
      );
    };

    const rows = HOSTS.map((x) => {
      const known = pool.some((v) => v.voiceURI === tts[x.key]);
      const autoVoice = x.key === 'voiceA' ? auto.a : auto.b;
      const select = h(
        'select',
        {
          id: x.id,
          value: known ? tts[x.key] : '',
          onchange: async (e) => {
            await updateSettings({ tts: { [x.key]: e.target.value } });
            paintNote();
          },
        },
        h('option', { value: '' }, autoVoice ? `Automatique (${autoVoice.name})` : 'Automatique'),
        pool.map((v) => h('option', { value: v.voiceURI }, label(v)))
      );
      const listen = h(
        'button.btn.btn-sm',
        {
          type: 'button',
          onclick: () => sample(x.text, { voice: chosen(x.key), rate: getSettings().tts.rate }),
        },
        icon('volume-2', { size: 16 }),
        `Écouter ${x.name}`
      );
      return h('div.field', h('label', { for: x.id }, `Voix d’${x.name}`), h('div.voice-row', select, listen));
    });

    const rateValue = h('output', { for: 'tts-rate' }, fmtRate(tts.rate));
    const rate = h('input', {
      id: 'tts-rate',
      type: 'range',
      min: '0.7',
      max: '1.4',
      step: '0.1',
      value: String(tts.rate),
      oninput: (e) => {
        rateValue.textContent = fmtRate(e.target.value);
      },
      onchange: (e) => updateSettings({ tts: { rate: Number(e.target.value) } }),
    });

    mount(
      root,
      !fr.length
        ? h(
            'div.callout.callout-warn',
            icon('triangle-alert'),
            h(
              'div',
              h('p', h('strong', 'Aucune voix française sur cet appareil.')),
              h('p', 'Installe-en une dans les paramètres de ton système (cherche « synthèse vocale » ou « voix », puis ajoute le français), puis recharge cette page. En attendant, tu peux afficher les voix d’autres langues ci-dessous.')
            )
          )
        : null,
      h('p', 'La causerie (le podcast) est dite par deux voix, Awa et Issa. Choisis celles que tu préfères, ou laisse l’appli choisir.'),
      rows,
      h('div.field', h('label', { for: 'tts-rate' }, 'Vitesse de lecture ', rateValue), rate, h('span.hint', 'Plus lent pour mieux suivre, plus rapide pour réviser vite.')),
      h(
        'label.switch',
        h('input', {
          type: 'checkbox',
          checked: showAll,
          onchange: (e) => {
            showAll = e.target.checked;
            render(voices);
          },
        }),
        'Afficher aussi les voix d’autres langues'
      ),
      note,
      h('p.hint', 'Les voix « sur l’appareil » ne sortent jamais de ton ordinateur ou de ton téléphone. Quand il n’en existe qu’une, elle est utilisée pour les deux animateurs avec deux tons différents.')
    );
    paintNote();
  }
  return root;
}
