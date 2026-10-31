// Sauvegarde, restauration et effacement des données : la logique, sans interface.
// Une sauvegarde contient les carnets (sources, cartes, quiz, fiches…) et JAMAIS les réglages
// ni les clés d'API : on peut donc la partager ou la ranger sans risque pour ses comptes.
import { exportAll, importAll, validateExport, wipeAll } from '../db.js';
import { resetSettingsInMemory } from '../settings.js';

export const MAX_BACKUP_BYTES = 400 * 1024 * 1024;

export const backupFilename = (date = new Date()) => `carnet-libre-sauvegarde-${date.toISOString().slice(0, 10)}.json`;

/** Combien d'éléments de chaque sorte contient une sauvegarde. */
export function summarizeBackup(data) {
  const n = (k) => (Array.isArray(data?.[k]) ? data[k].length : 0);
  return { notebooks: n('notebooks'), sources: n('sources'), cards: n('cards'), quizzes: n('quizzes'), notes: n('notes'), casts: n('casts'), decks: n('decks') };
}

/** Texte de la sauvegarde à télécharger. */
export async function createBackup() {
  const data = await exportAll();
  return { text: JSON.stringify(data), name: backupFilename(), summary: summarizeBackup(data) };
}

/** Lit et vérifie un fichier de sauvegarde. Lève une erreur en français si le fichier est invalide. */
export async function readBackup(file) {
  if (!file) throw new Error('Aucun fichier choisi.');
  if (file.size > MAX_BACKUP_BYTES) throw new Error('Ce fichier est beaucoup trop gros pour être une sauvegarde de Carnet Libre.');
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error('Ce fichier n’est pas une sauvegarde de Carnet Libre : il ne se lit pas comme une sauvegarde (JSON).');
  }
  validateExport(data);
  return data;
}

export const restoreBackup = importAll;

/**
 * Efface tout ce que l'appli a gardé sur l'appareil : carnets, réglages, clés, mode hors ligne.
 * La page doit ensuite être rechargée.
 */
export async function eraseEverything() {
  await wipeAll();
  resetSettingsInMemory();
  try {
    for (const reg of (await globalThis.navigator?.serviceWorker?.getRegistrations?.()) || []) await reg.unregister();
  } catch {
    /* pas de mode hors ligne à retirer */
  }
  try {
    for (const key of (await globalThis.caches?.keys?.()) || []) await globalThis.caches.delete(key);
  } catch {
    /* pas de cache à vider */
  }
}
