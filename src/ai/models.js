// Aide au choix du modèle : parmi la liste d'un fournisseur, propose un modèle raisonnable
// pour des cours (rapide, gratuit, bon en français). C'est un conseil, jamais une obligation :
// les noms de modèles changent souvent, donc on cherche des motifs et non des noms exacts.

const version = (id) => {
  const m = /(\d+(?:\.\d+)?)/.exec(id);
  return m ? parseFloat(m[1]) : 0;
};

/**
 * @param {string} providerId
 * @param {{id: string}[]} models
 * @returns {string} identifiant du modèle conseillé, ou '' s'il n'y a aucun choix
 */
export function suggestModel(providerId, models) {
  const ids = (models || []).map((m) => m.id).filter(Boolean);
  if (!ids.length) return '';
  const find = (re) => ids.find((id) => re.test(id));
  const best = (list) => [...list].sort((a, b) => version(b) - version(a) || a.localeCompare(b))[0];

  switch (providerId) {
    case 'gemini': {
      const plain = ids.filter((id) => /^gemini-\d+(\.\d+)?-flash$/.test(id));
      if (plain.length) return best(plain);
      const other = ids.filter((id) => /flash/i.test(id) && !/(lite|image|live|tts|thinking|exp|preview)/i.test(id));
      return other.length ? best(other) : find(/flash/i) || ids[0];
    }
    case 'groq':
      return find(/^llama-3\.3-70b-versatile$/) || find(/^llama-3\.1-8b-instant$/) || find(/gpt-oss-20b/i) || find(/llama/i) || ids[0];
    case 'openrouter':
      return find(/^openrouter\/free$/) || find(/(llama|qwen|mistral|gemma).*:free$/i) || ids[0];
    case 'mistral':
      return find(/^mistral-small-latest$/) || find(/small/i) || find(/^open-mistral/i) || ids[0];
    default:
      return ids[0]; // Ollama, serveur perso : la personne n'a installé que ce qu'elle veut
  }
}
