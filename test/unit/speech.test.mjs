import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReader, defaultVoices, findVoice, frenchVoices, prepareSpeech, splitSentences, texToSpeech } from '../../src/tts/speech.js';

const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ formules

test('texToSpeech : fractions, puissances, racines', () => {
  assert.equal(texToSpeech('\\frac{1}{2}'), '1 sur 2');
  assert.match(texToSpeech('\\frac{a+1}{b-1}'), /la fraction a plus 1, sur b moins 1, fin de fraction/);
  assert.equal(texToSpeech('x^2'), 'x au carré');
  assert.equal(texToSpeech('x^3'), 'x au cube');
  assert.equal(texToSpeech('x^n'), 'x puissance n');
  assert.match(texToSpeech('z^{n+1}'), /z puissance, n plus 1, fin de puissance/);
  assert.equal(texToSpeech('u_n'), 'u indice n');
  assert.equal(texToSpeech('\\sqrt{x}'), 'racine carrée de x');
  assert.equal(texToSpeech('\\sqrt[3]{x}'), 'racine cubique de x');
});

test('texToSpeech : somme, intégrale, limite, relations', () => {
  assert.equal(texToSpeech('\\sum_{i=1}^{n} u_i'), 'somme pour i égale 1 jusqu’à n de u indice i');
  assert.match(texToSpeech('\\int_{0}^{1} f(x)\\,dx'), /^intégrale de 0 à 1, de f de x/);
  assert.match(texToSpeech('\\lim_{x \\to +\\infty} \\frac{1}{x} = 0'), /^limite quand x tend vers plus l’infini, de 1 sur x égale 0$/);
  assert.equal(texToSpeech('a \\leq b'), 'a inférieur ou égal à b');
  assert.equal(texToSpeech('x \\in \\mathbb{R}'), 'x appartient à grand R');
  assert.equal(texToSpeech('\\alpha + \\pi'), 'alpha plus pi');
  assert.equal(texToSpeech('\\vec{u}'), 'vecteur u');
});

test('texToSpeech : le grand R puissance 2 se lit « grand R 2 », pas « au carré »', () => {
  assert.equal(texToSpeech('\\mathbb{R}^2'), 'grand R 2');
});

test('texToSpeech : commande inconnue → son nom ; texte absurde → ne plante pas', () => {
  assert.equal(texToSpeech('\\truc'), 'truc');
  assert.equal(typeof texToSpeech('\\frac{1'), 'string');
  assert.equal(texToSpeech(''), '');
  assert.equal(texToSpeech(null), '');
});

// ------------------------------------------------------------------ préparation du texte

test('prepareSpeech : retire la mise en forme, les citations et les liens', () => {
  const out = prepareSpeech('## Titre\n- **Gras** et *italique* [1][2]\n\nVoir [le cours](https://exemple.org/x) et https://autre.org/y.');
  assert.doesNotMatch(out, /[#*\[\]]|https?:/);
  assert.match(out, /Titre/);
  assert.match(out, /Gras et italique/);
  assert.match(out, /Voir le cours et/);
});

test('prepareSpeech : dit les formules et les symboles', () => {
  assert.match(prepareSpeech('On a $E = mc^2$ ici.'), /E égale mc au carré/);
  assert.match(prepareSpeech('Soit $$\\frac{1}{2}$$ la moitié.'), /1 sur 2/);
  assert.match(prepareSpeech('x² ≤ 4 et π ≈ 3,14'), /x au carré inférieur ou égal à 4 et pi environ égal à 3,14/);
  assert.match(prepareSpeech('Il fait 25°C.'), /25 degrés Celsius/);
});

test('prepareSpeech : un bloc de code n’est pas lu', () => {
  assert.equal(prepareSpeech('Avant\n```js\nconst x = 1;\n```\nAprès'), 'Avant\n\nAprès');
});

test('splitSentences : phrases, longueur maximale, fragments vides', () => {
  assert.deepEqual(splitSentences('Première phrase. Deuxième phrase ! Et une troisième ? Oui.'), ['Première phrase.', 'Deuxième phrase !', 'Et une troisième ?', 'Oui.']);
  assert.deepEqual(splitSentences('Ligne un\nLigne deux'), ['Ligne un', 'Ligne deux']);
  assert.deepEqual(splitSentences('... ?! ---'), []);
  const long = Array.from({ length: 40 }, (_, i) => `mot${i}`).join(' ') + ', fin de la longue phrase sans point';
  const parts = splitSentences(long, 80);
  assert.ok(parts.length > 2);
  assert.ok(parts.every((p) => p.length <= 80), 'aucune phrase ne dépasse la limite');
  assert.equal(parts.join(' ').replace(/\s+/g, ' '), long.replace(/\s+/g, ' '), 'rien n’est perdu');
});

// ------------------------------------------------------------------ voix

const V = (name, lang, localService, voiceURI = name) => ({ name, lang, localService, voiceURI });

test('voix : françaises seulement, celles de l’appareil d’abord', () => {
  const voices = [V('Google français', 'fr-FR', false), V('Hortense', 'fr-FR', true), V('Samantha', 'en-US', true), V('Paul', 'fr_FR', true), V('Amelie', 'fr-CA', true)];
  assert.deepEqual(frenchVoices(voices).map((v) => v.name), ['Amelie', 'Hortense', 'Paul', 'Google français']);
  const { a, b } = defaultVoices(voices);
  assert.notEqual(a.name, b.name, 'deux voix différentes pour la causerie');
  assert.ok(a.localService && b.localService, 'on préfère les voix qui ne sortent pas de l’appareil');
  assert.equal(findVoice(voices, 'Paul').name, 'Paul');
  assert.equal(findVoice(voices, 'inconnue'), null);
  assert.equal(findVoice(voices, ''), null);
});

test('voix : une seule voix → la même pour les deux ; aucune → null', () => {
  const one = defaultVoices([V('Hortense', 'fr-FR', true)]);
  assert.equal(one.a, one.b);
  assert.deepEqual(defaultVoices([V('Samantha', 'en-US', true)]), { a: null, b: null });
  assert.deepEqual(defaultVoices([]), { a: null, b: null });
});

// ------------------------------------------------------------------ lecteur

function fakeEngine() {
  let current = null;
  const synth = {
    spoken: [],
    speak(ut) {
      synth.spoken.push(ut);
      current = ut;
    },
    cancel() {
      current = null;
    },
    finish() {
      const u = current;
      current = null;
      u?.onend?.();
    },
    fail(error) {
      const u = current;
      current = null;
      u?.onerror?.({ error });
    },
    get texts() {
      return synth.spoken.map((u) => u.text);
    },
  };
  class Utterance {
    constructor(text) {
      this.text = text;
    }
  }
  return { synth, Utterance };
}

function makeReader(extra = {}) {
  const engine = fakeEngine();
  const events = { segments: [], ends: 0, states: [], errors: [] };
  const reader = createReader({
    synth: engine.synth,
    Utterance: engine.Utterance,
    onSegment: (i) => events.segments.push(i),
    onEnd: () => events.ends++,
    onState: (s) => events.states.push(s),
    onError: (m) => events.errors.push(m),
    ...extra,
  });
  return { ...engine, reader, events };
}

test('lecteur : lit les phrases dans l’ordre, annonce chaque segment, puis se termine', async () => {
  const { synth, reader, events } = makeReader();
  reader.load([{ text: 'Bonjour à tous. Voici le cours.' }, { text: 'Merci.' }]);
  assert.equal(reader.length, 2);
  reader.play();
  await wait();
  assert.deepEqual(synth.texts, ['Bonjour à tous.']);
  synth.finish();
  assert.deepEqual(synth.texts, ['Bonjour à tous.', 'Voici le cours.']);
  synth.finish();
  synth.finish();
  assert.deepEqual(synth.texts, ['Bonjour à tous.', 'Voici le cours.', 'Merci.']);
  assert.deepEqual(events.segments, [0, 1], 'un événement par segment, pas par phrase');
  synth.finish();
  assert.equal(events.ends, 1);
  assert.equal(reader.state, 'idle');
  assert.deepEqual(events.states, ['playing', 'idle']);
});

test('lecteur : la voix, la langue et la vitesse du segment sont transmises', async () => {
  const { synth, reader } = makeReader();
  const voice = V('Paul', 'fr-FR', true);
  reader.load([{ text: 'Salut.', voice, pitch: 0.8, rate: 1.1 }]);
  reader.setRate(1.5);
  reader.play();
  await wait();
  const u = synth.spoken[0];
  assert.equal(u.voice, voice);
  assert.equal(u.lang, 'fr-FR');
  assert.equal(u.pitch, 0.8);
  assert.ok(Math.abs(u.rate - 1.65) < 1e-9, 'vitesse du segment × vitesse du lecteur');
});

test('lecteur : pause puis reprise relit la phrase en cours', async () => {
  const { synth, reader, events } = makeReader();
  reader.load([{ text: 'Une. Deux. Trois.' }]);
  reader.play();
  await wait();
  synth.finish(); // « Une. » lue ; « Deux. » commence
  assert.deepEqual(synth.texts, ['Une.', 'Deux.']);
  reader.pause();
  assert.equal(reader.state, 'paused');
  synth.finish(); // un événement tardif de l'ancien énoncé ne doit rien déclencher
  await wait();
  assert.deepEqual(synth.texts, ['Une.', 'Deux.']);
  reader.resume();
  await wait();
  assert.deepEqual(synth.texts, ['Une.', 'Deux.', 'Deux.']);
  assert.deepEqual(events.states, ['playing', 'paused', 'playing']);
});

test('lecteur : suivant / précédent changent de segment', async () => {
  const { synth, reader, events } = makeReader();
  reader.load([{ text: 'Alpha.' }, { text: 'Bêta.' }, { text: 'Gamma.' }]);
  reader.play();
  await wait();
  reader.next();
  await wait();
  assert.equal(synth.texts.at(-1), 'Bêta.');
  reader.next();
  await wait();
  assert.equal(synth.texts.at(-1), 'Gamma.');
  reader.prev();
  await wait();
  assert.equal(synth.texts.at(-1), 'Bêta.');
  assert.equal(reader.segment, 1);
  assert.deepEqual(events.segments, [0, 1, 2, 1]);
  reader.next();
  reader.next();
  await wait();
  assert.equal(reader.state, 'idle', 'au-delà du dernier segment, la lecture s’arrête');
});

test('lecteur : « suivant » à l’arrêt ne lance rien ; en pause, il change de segment sans parler', async () => {
  const { synth, reader, events } = makeReader();
  reader.load([{ text: 'Alpha.' }, { text: 'Bêta.' }]);
  reader.next();
  await wait();
  assert.deepEqual(synth.texts, []);
  assert.equal(reader.state, 'idle');

  reader.play();
  await wait();
  reader.pause();
  reader.next();
  await wait();
  assert.equal(reader.state, 'paused');
  assert.deepEqual(synth.texts, ['Alpha.'], 'rien de nouveau n’est dit pendant la pause');
  assert.deepEqual(events.segments, [0, 1], 'mais l’interface voit le segment 2');
  reader.resume();
  await wait();
  assert.deepEqual(synth.texts, ['Alpha.', 'Bêta.']);
  assert.deepEqual(events.segments, [0, 1], 'la reprise n’annonce pas deux fois le même segment');
});

test('texToSpeech : pas de virgule parasite au début ni à la fin', () => {
  assert.doesNotMatch(texToSpeech('\\frac{a+1}{b-1}'), /^,|,$/);
});

test('lecteur : les segments sans rien à dire sont sautés', async () => {
  const { synth, reader, events } = makeReader();
  reader.load([{ text: '[1]' }, { text: 'Vrai texte.' }, { text: '```x```' }]);
  reader.play();
  await wait();
  assert.deepEqual(synth.texts, ['Vrai texte.']);
  assert.deepEqual(events.segments, [1]);
  synth.finish();
  assert.equal(events.ends, 1);
});

test('lecteur : une annulation (« canceled ») n’est pas une erreur ; trois échecs d’affilée arrêtent tout', async () => {
  const { synth, reader, events } = makeReader();
  reader.load([{ text: 'Un. Deux. Trois. Quatre.' }]);
  reader.play();
  await wait();
  synth.fail('canceled');
  assert.deepEqual(synth.texts, ['Un.'], 'rien n’a avancé');
  assert.equal(events.errors.length, 0);

  const second = makeReader();
  second.reader.load([{ text: 'Un. Deux. Trois. Quatre.' }]);
  second.reader.play();
  await wait();
  second.synth.fail('synthesis-failed');
  second.synth.fail('synthesis-failed');
  assert.equal(second.events.errors.length, 0, 'deux échecs : on persiste');
  second.synth.fail('synthesis-failed');
  assert.equal(second.events.errors.length, 1);
  assert.match(second.events.errors[0], /autre voix/);
  assert.equal(second.reader.state, 'idle');
});

test('lecteur : sans moteur de synthèse, play() le dit au lieu de planter', () => {
  const errors = [];
  const reader = createReader({ synth: null, Utterance: null, onError: (m) => errors.push(m) });
  reader.load([{ text: 'Bonjour.' }]);
  assert.equal(reader.play(), false);
  assert.equal(errors.length, 1);
});
