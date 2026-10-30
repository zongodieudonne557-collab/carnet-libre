import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestModel } from '../../src/ai/models.js';

const L = (...ids) => ids.map((id) => ({ id }));

test('suggestModel : liste vide → rien', () => {
  assert.equal(suggestModel('groq', []), '');
  assert.equal(suggestModel('groq', undefined), '');
});

test('suggestModel : Gemini prend le « flash » le plus récent, pas le « lite » ni l’aperçu', () => {
  assert.equal(suggestModel('gemini', L('gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro', 'gemini-3-flash-preview')), 'gemini-2.5-flash');
  assert.equal(suggestModel('gemini', L('gemini-3-flash', 'gemini-2.5-flash')), 'gemini-3-flash');
  assert.equal(suggestModel('gemini', L('gemini-2.5-pro', 'gemini-flash-latest')), 'gemini-flash-latest', 'repli sur un « flash » quelconque');
  assert.equal(suggestModel('gemini', L('gemini-2.5-pro')), 'gemini-2.5-pro', 'dernier recours : le premier');
});

test('suggestModel : Groq préfère un Llama polyvalent', () => {
  assert.equal(suggestModel('groq', L('gemma2-9b-it', 'llama-3.1-8b-instant', 'llama-3.3-70b-versatile')), 'llama-3.3-70b-versatile');
  assert.equal(suggestModel('groq', L('gemma2-9b-it', 'llama-3.1-8b-instant')), 'llama-3.1-8b-instant');
  assert.equal(suggestModel('groq', L('qwen-x', 'meta-llama/llama-4-scout')), 'meta-llama/llama-4-scout');
  assert.equal(suggestModel('groq', L('autre')), 'autre');
});

test('suggestModel : OpenRouter préfère le routeur gratuit', () => {
  assert.equal(suggestModel('openrouter', L('qwen/qwen3:free', 'openrouter/free')), 'openrouter/free');
  assert.equal(suggestModel('openrouter', L('zzz:free', 'meta-llama/llama-3.3-70b-instruct:free')), 'meta-llama/llama-3.3-70b-instruct:free');
});

test('suggestModel : Mistral préfère « small »', () => {
  assert.equal(suggestModel('mistral', L('mistral-large-latest', 'mistral-small-latest')), 'mistral-small-latest');
  assert.equal(suggestModel('mistral', L('mistral-large-latest', 'ministral-small-2')), 'ministral-small-2');
});

test('suggestModel : Ollama et serveur perso → le premier', () => {
  assert.equal(suggestModel('ollama', L('llama3.2:3b', 'qwen2.5:7b')), 'llama3.2:3b');
  assert.equal(suggestModel('custom', L('x')), 'x');
});
