// Réglages : IA (fournisseur, clé, modèle, accord d'envoi), apparence, voix, hors ligne, données, à propos.
import { getApiKey, getSettings, hasConsent, revokeConsent, setApiKey, subscribe, updateSettings } from '../../settings.js';
import { listModels, resolveConfig, testConnection } from '../../ai/client.js';
import { suggestModel } from '../../ai/models.js';
import { PROVIDERS, PROVIDER_ORDER, isLocalUrl } from '../../ai/providers.js';
import { BUDGETS, CHARS_PER_TOKEN } from '../../ai/rag.js';
import { APP_VERSION, REPO_URL } from '../../version.js';
import { formatDate } from '../../util.js';
import { askConsent, kindChip, privacyBlock } from '../ai-gate.js';
import { secretInput, segmented } from '../controls.js';
import { h, icon, mount, plural, toast } from '../dom.js';
import { href } from '../router.js';
import { dataSection } from '../settings-data.js';
import { offlineSection } from '../settings-offline.js';
import { voiceSection } from '../settings-voice.js';

// Listes de modèles déjà récupérées pendant cette session (providerId → [{id, label}]).
const modelCache = new Map();

const field = (id, label, control, hint) =>
  h('div.field', h('label', { for: id }, label), control, hint ? h('span.hint', { id: `${id}-hint` }, hint) : null);

const callout = (kind, ic, ...content) => h(`div.callout${kind ? `.callout-${kind}` : ''}`, icon(ic), h('div', content));

// ------------------------------------------------------------------ intelligence artificielle

function providerPicker(current, onPick) {
  const name = 'ai-provider';
  return h(
    'div.prov-list',
    { role: 'radiogroup', 'aria-label': 'Fournisseur d’IA' },
    PROVIDER_ORDER.map((id) => {
      const p = PROVIDERS[id];
      return h(
        'label.prov',
        { dataset: { kind: p.kind } },
        h('input', { type: 'radio', name, value: id, checked: id === current, onchange: () => onPick(id) }),
        h('span.prov-name', p.name),
        h('span.prov-tag', p.tagline),
        h('span.chips', kindChip(p), p.privacy?.trains === 'yes' ? h('span.chip.chip-bad', 'Réutilise tes textes') : null)
      );
    })
  );
}

function budgetHint(key) {
  const b = BUDGETS[key] || BUDGETS.medium;
  const pages = Math.max(1, Math.round((b.tokens * CHARS_PER_TOKEN) / 2000));
  return `${b.hint}. Environ ${plural(pages, 'page')} de cours par demande.`;
}

function providerPanel(p, rerender) {
  const ai = () => getSettings().ai;
  const status = h('div.status', { 'aria-live': 'polite' });
  const STATUS_ICON = { bad: 'triangle-alert', warn: 'triangle-alert', ok: 'circle-check' };
  const setStatus = (kind, text) => mount(status, text ? callout(kind, STATUS_ICON[kind] || 'info', h('p', text)) : null);

  // --- adresse du serveur (serveur perso)
  let urlField = null;
  if (p.id === 'custom') {
    const warn = h('div', { 'aria-live': 'polite' });
    const paintWarn = (value) =>
      mount(
        warn,
        value && !isLocalUrl(value)
          ? callout(
              'warn',
              'triangle-alert',
              h('p', 'Un serveur perso doit tourner sur ton ordinateur (adresse en localhost ou 127.0.0.1) : c’est la seule forme que la règle de sécurité de l’appli autorise sans accord. Pour utiliser un service en ligne, ajoute-le comme fournisseur avec ses règles de confidentialité (voir « Ajouter un fournisseur » dans la documentation).')
            )
          : null
      );
    const input = h('input', {
      id: 'ai-url',
      type: 'url',
      placeholder: 'http://localhost:1234/v1',
      value: ai().baseUrl,
      'aria-describedby': 'ai-url-hint',
      oninput: (e) => paintWarn(e.target.value.trim()),
      onchange: (e) => updateSettings({ ai: { baseUrl: e.target.value.trim() } }),
    });
    paintWarn(ai().baseUrl);
    urlField = h('div', field('ai-url', 'Adresse du serveur', input, 'Elle doit se terminer par « /v1 » ou équivalent, comme dans la documentation de ton serveur.'), warn);
  }

  // --- clé d'API
  let keyField = null;
  let rememberField = null;
  let saveKey = async () => {};
  if (p.needsKey || p.id === 'custom') {
    const secret = secretInput({ id: 'ai-key', value: getApiKey(p.id), label: `la clé ${p.short}`, placeholder: p.needsKey ? 'Colle ta clé ici' : 'Facultatif' });
    saveKey = async () => {
      const value = secret.input.value.trim();
      if (value !== getApiKey(p.id)) await setApiKey(value, ai().remember, p.id);
    };
    secret.input.addEventListener('change', saveKey);
    secret.input.setAttribute('aria-describedby', 'ai-key-hint');
    keyField = h(
      'div.field',
      h('label', { for: 'ai-key' }, p.needsKey ? `Ta clé ${p.short}` : `Clé (facultative)`),
      secret.el,
      h('span.hint', { id: 'ai-key-hint' }, 'La clé est comme un mot de passe : ne la partage pas. Elle reste en mémoire et disparaît quand tu fermes l’onglet, sauf si tu coches « Mémoriser » ci-dessous.')
    );
    rememberField = h(
      'div.field',
      h(
        'label.switch',
        h('input', {
          type: 'checkbox',
          checked: ai().remember,
          'aria-describedby': 'ai-remember-hint',
          onchange: async (e) => {
            await setApiKey(secret.input.value.trim() || getApiKey(p.id), e.target.checked, p.id);
            toast(e.target.checked ? 'Clés mémorisées sur cet appareil.' : 'Clés oubliées : elles ne restent plus qu’en mémoire.', { timeout: 2500 });
          },
        }),
        'Mémoriser sur cet appareil'
      ),
      h('span.hint', { id: 'ai-remember-hint' }, 'Enregistrée en clair dans ce navigateur : ne le fais pas sur un ordinateur partagé (cybercafé, salle informatique).')
    );
  }

  // --- modèle
  const modelSelect = h('select', { id: 'ai-model', 'aria-describedby': 'ai-model-hint' });
  const modelManual = h('input', { id: 'ai-model-manual', type: 'text', placeholder: 'nom-du-modèle', 'aria-label': 'Nom du modèle', autocomplete: 'off', autocapitalize: 'off', spellcheck: false, hidden: true });
  const saveModel = (id) => updateSettings({ ai: { model: id, models: { [p.id]: id } } });
  function paintModels() {
    const list = modelCache.get(p.id) || [];
    const current = ai().model;
    const known = list.some((m) => m.id === current);
    mount(
      modelSelect,
      !current ? h('option', { value: '' }, list.length ? '— Choisis un modèle —' : '— Appuie sur « Actualiser la liste » —') : null,
      list.map((m) => h('option', { value: m.id }, m.label)),
      current && !known ? h('option', { value: current }, `${current} (enregistré)`) : null,
      h('option', { value: '__other' }, 'Autre : taper le nom…')
    );
    modelSelect.value = current || '';
    if (modelSelect.value !== (current || '')) modelSelect.selectedIndex = 0;
  }
  modelSelect.addEventListener('change', async () => {
    if (modelSelect.value === '__other') {
      modelManual.hidden = false;
      modelManual.value = '';
      modelManual.focus();
      return;
    }
    modelManual.hidden = true;
    await saveModel(modelSelect.value);
  });
  modelManual.addEventListener('change', async () => {
    const v = modelManual.value.trim().replace(/^models\//, '');
    if (!v) return;
    await saveModel(v);
    modelManual.hidden = true;
    paintModels();
  });
  paintModels();

  async function refreshModels(btn) {
    await saveKey();
    let cfg;
    try {
      cfg = resolveConfig();
    } catch (e) {
      setStatus('bad', e.message);
      return;
    }
    btn.disabled = true;
    setStatus('', 'Chargement de la liste…');
    try {
      const models = await listModels(cfg);
      modelCache.set(p.id, models);
      if (!models.length) {
        setStatus('warn', p.kind === 'local' ? 'Aucun modèle trouvé. Installe-en un (voir les étapes ci-dessus), puis réessaie.' : 'Aucun modèle utilisable n’a été trouvé pour cette clé.');
      } else {
        const cur = ai().model;
        let msg = `${plural(models.length, 'modèle')} disponible${models.length > 1 ? 's' : ''}.`;
        if (!cur || !models.some((m) => m.id === cur)) {
          const pick = suggestModel(p.id, models);
          if (pick) {
            await saveModel(pick);
            msg += ` Modèle conseillé choisi : ${pick}. Tu peux en prendre un autre dans la liste.`;
          }
        }
        setStatus('ok', msg);
      }
      paintModels();
    } catch (e) {
      setStatus('bad', e.message);
    } finally {
      btn.disabled = false;
    }
  }

  const refreshBtn = h('button.btn', { type: 'button', onclick: (e) => refreshModels(e.currentTarget) }, icon('refresh-cw', { size: 18 }), 'Actualiser la liste');
  const modelField = h(
    'div.field',
    h('label', { for: 'ai-model' }, 'Modèle'),
    h('div.model-row', modelSelect, refreshBtn),
    modelManual,
    h('span.hint', { id: 'ai-model-hint' }, p.id === 'gemini' ? 'Choisis un modèle « flash » : les modèles « pro » sont souvent payants.' : p.id === 'openrouter' ? 'Les modèles gratuits ont un nom qui se termine par « :free ».' : 'Si la liste ne s’affiche pas, tape le nom du modèle toi-même (« Autre »).')
  );
  const onlyFree =
    p.id === 'openrouter'
      ? h(
          'div.field',
          h(
            'label.switch',
            h('input', {
              type: 'checkbox',
              checked: ai().onlyFree,
              onchange: async (e) => {
                await updateSettings({ ai: { onlyFree: e.target.checked } });
                modelCache.delete(p.id);
                paintModels();
              },
            }),
            'Ne montrer que les modèles gratuits'
          )
        )
      : null;

  // --- test de connexion
  async function runTest(btn) {
    await saveKey();
    let cfg;
    try {
      cfg = resolveConfig();
    } catch (e) {
      setStatus('bad', e.message);
      return;
    }
    btn.disabled = true;
    setStatus('', 'Test en cours…');
    try {
      const r = await testConnection(cfg);
      modelCache.set(p.id, r.models);
      paintModels();
      setStatus(
        'ok',
        r.reply !== null
          ? `Ça marche : le modèle « ${cfg.model} » a répondu${r.reply ? ` « ${r.reply} »` : ''}.`
          : `Connexion réussie (${plural(r.models.length, 'modèle')} disponible${r.models.length > 1 ? 's' : ''}). Choisis un modèle pour terminer le réglage.`
      );
    } catch (e) {
      setStatus('bad', e.message);
    } finally {
      btn.disabled = false;
    }
  }

  // --- accord d'envoi (services en ligne)
  let consent = null;
  if (p.kind === 'cloud') {
    const given = hasConsent(p.id);
    const at = getSettings().consent[p.id]?.at;
    consent = h(
      'div.consent',
      given
        ? [
            h('span.chip.chip-ok', icon('circle-check', { size: 14 }), `Accord donné${at ? ` le ${formatDate(at)}` : ''}`),
            h(
              'button.btn.btn-sm',
              {
                type: 'button',
                onclick: async () => {
                  await revokeConsent(p.id);
                  toast(`Accord retiré : rien ne sera envoyé à ${p.short} sans que tu le redonnes.`, { timeout: 5000 });
                  rerender();
                },
              },
              'Retirer mon accord'
            ),
          ]
        : [
            h('span.chip.chip-warn', 'Accord pas encore donné'),
            h('button.btn.btn-sm', { type: 'button', onclick: async () => (await askConsent(p)) && rerender() }, 'Lire et accepter…'),
            h('span.hint', 'Sans accord, rien n’est envoyé : l’appli te le demandera avant le premier envoi.'),
          ]
    );
  }

  // --- quantité de texte envoyée
  const hint = h('span.hint', { id: 'ai-budget-hint', 'aria-live': 'polite' }, budgetHint(ai().budget));
  const budget = segmented({
    label: 'Quantité de texte envoyée',
    options: Object.entries(BUDGETS).map(([value, b]) => ({ value, label: b.label })),
    value: ai().budget,
    onChange: (v) => {
      updateSettings({ ai: { budget: v } });
      hint.textContent = budgetHint(v);
    },
  });

  return h(
    'div.panel',
    h('h3', p.name),
    p.steps?.length ? h('ol.steps', p.steps.map((t) => h('li', t))) : null,
    p.keyUrl ? h('p', h('a.btn.btn-sm', { href: p.keyUrl, target: '_blank', rel: 'noopener noreferrer' }, icon('key-round', { size: 16 }), 'Ouvrir la page des clés', icon('external-link', { size: 14 }))) : null,
    privacyBlock(p),
    urlField,
    keyField,
    rememberField,
    modelField,
    onlyFree,
    h(
      'div.field',
      h('div.btn-row', h('button.btn.btn-primary', { type: 'button', onclick: (e) => runTest(e.currentTarget) }, icon('circle-check', { size: 18 }), 'Tester la connexion'), h('span.hint', p.kind === 'cloud' ? `Envoie le mot « ok » à ${p.short} avec ta clé. Aucun texte de cours n’est envoyé.` : 'Aucun texte de cours n’est envoyé.')),
      status
    ),
    consent,
    h('div.field', h('p.label', { id: 'ai-budget-label' }, 'Quantité de texte envoyée à chaque demande'), budget, hint)
  );
}

function aiSection() {
  const panel = h('div.ai-panel');
  const render = () => {
    const p = PROVIDERS[getSettings().ai.provider] || PROVIDERS.none;
    mount(
      panel,
      p.kind === 'none'
        ? callout('', 'info', h('p', h('strong', 'Sans IA, Carnet Libre reste utile.'), ' Tu peux chercher dans tes cours, réviser des cartes créées automatiquement et écouter tes cours à voix haute. Pour des réponses rédigées, des quiz, des fiches, un podcast ou des diapos, choisis une IA ci-dessus.'))
        : providerPanel(p, render)
    );
  };
  async function pick(id) {
    const ai = getSettings().ai;
    if (id === ai.provider) return;
    await updateSettings({ ai: { provider: id, model: ai.models?.[id] || '' } });
    render();
  }
  render();
  return h(
    'div',
    h('p', 'L’IA est facultative. Tu choisis laquelle, et ce que chacune fait de tes textes est écrit en clair avant que quoi que ce soit parte.'),
    providerPicker(getSettings().ai.provider, pick),
    panel
  );
}

// ------------------------------------------------------------------ apparence

function lookSection(onCleanup) {
  const ui = getSettings().ui;
  const theme = segmented({
    label: 'Thème',
    options: [
      { value: 'auto', label: 'Automatique', icon: 'monitor' },
      { value: 'light', label: 'Clair', icon: 'sun', title: 'Clair : papier Seyès' },
      { value: 'dark', label: 'Sombre', icon: 'moon', title: 'Sombre : tableau d’école' },
    ],
    value: ui.theme,
    onChange: (v) => updateSettings({ ui: { theme: v } }),
  });
  const size = segmented({
    label: 'Taille du texte',
    options: [
      { value: 1, label: 'Normale' },
      { value: 1.15, label: 'Grande' },
      { value: 1.3, label: 'Très grande' },
      { value: 1.5, label: 'Énorme' },
    ],
    value: ui.fontScale,
    onChange: (v) => updateSettings({ ui: { fontScale: v } }),
  });
  // le thème peut aussi être changé depuis le bouton de l'en-tête : on reste synchronisé
  onCleanup(
    subscribe((s) => {
      theme.setValue(s.ui.theme);
      size.setValue(s.ui.fontScale);
    })
  );
  return h(
    'div',
    h('div.field', h('p.label', 'Thème'), theme, h('span.hint', 'Clair : feuille de cahier. Sombre : tableau d’école, plus reposant le soir. Automatique suit ton appareil.')),
    h('div.field', h('p.label', 'Taille du texte'), size),
    h('p.sample', 'Voici un exemple de texte : la photosynthèse transforme la lumière du soleil en énergie chimique.')
  );
}

// ------------------------------------------------------------------ à propos

function aboutSection() {
  return h(
    'div.about',
    h('p', h('strong', `Carnet Libre ${APP_VERSION}`), ' — une appli libre (licence MIT), gratuite, sans publicité, sans compte et sans suivi.'),
    h('p', 'Tout se passe dans ton navigateur. ', h('a', { href: href('/confidentialite') }, 'Lire comment tes données sont protégées'), '.'),
    REPO_URL ? h('p', h('a', { href: REPO_URL, target: '_blank', rel: 'noopener noreferrer' }, 'Voir le code source', icon('external-link', { size: 14 }))) : null,
    h('p.small.muted', 'Carnet Libre est un projet indépendant, inspiré des carnets de type NotebookLM. Il n’est affilié ni à Google ni à NotebookLM.')
  );
}

// ------------------------------------------------------------------ page

export default async function settingsView({ root, onCleanup, setTitle }) {
  setTitle('Réglages');
  const sections = [
    { id: 'ia', title: 'Intelligence artificielle', icon: 'sparkles', el: aiSection() },
    { id: 'apparence', title: 'Apparence', icon: 'sun', el: lookSection(onCleanup) },
    { id: 'voix', title: 'Lecture à voix haute', icon: 'volume-2', el: voiceSection() },
    { id: 'hors-ligne', title: 'Hors ligne', icon: 'wifi-off', el: offlineSection(onCleanup) },
    { id: 'donnees', title: 'Mes données', icon: 'hard-drive', el: dataSection() },
    { id: 'apropos', title: 'À propos', icon: 'info', el: aboutSection() },
  ];
  const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  mount(
    root,
    h(
      'div.page.settings',
      h('header.page-head', h('h1', { 'data-focus': '', tabindex: '-1' }, 'Réglages'), h('p.lead', 'Tout est enregistré sur cet appareil. Rien n’est envoyé nulle part sans ton accord.')),
      h(
        'nav.jump',
        { 'aria-label': 'Aller à une section' },
        sections.map((s) =>
          h(
            'button.btn.btn-sm',
            {
              type: 'button',
              onclick: () => {
                const target = document.getElementById(`set-${s.id}`);
                target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
                target.focus({ preventScroll: true });
              },
            },
            icon(s.icon, { size: 16 }),
            s.title
          )
        )
      ),
      sections.map((s) => h('section.set', { 'aria-labelledby': `set-${s.id}` }, h('h2', { id: `set-${s.id}`, tabindex: '-1' }, icon(s.icon, { size: 26 }), s.title), s.el))
    )
  );
}
