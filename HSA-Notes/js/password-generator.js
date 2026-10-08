import { t } from './i18n.js';
import { getSetting, saveSetting } from './storage.js';
import { copyText, escapeHTML, icon, showToast } from './ui.js';

const MIN_PASSWORD_LENGTH = 4;
const MAX_PASSWORD_LENGTH = 64;
const MAX_HISTORY = 5;
const MIN_PASSPHRASE_WORDS = 2;
const MAX_PASSPHRASE_WORDS = 8;
const DEFAULT_OPTIONS = Object.freeze({
  mode: 'password',
  length: 16,
  uppercase: true,
  lowercase: true,
  numbers: true,
  symbols: true,
  excludeAmbiguous: false,
  customExclusions: '',
  wordCount: 4,
  numberDigits: 2,
  separator: '-'
});
const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const NUMBERS = '0123456789';
const SYMBOLS = '!@#$%^&*()-_=+[]{};:,.?/';
const AMBIGUOUS = 'l1IO0';
const OPTION_KEYS = new Set(['mode', 'length', 'uppercase', 'lowercase', 'numbers', 'symbols', 'excludeAmbiguous', 'customExclusions', 'wordCount']);
const BOOLEAN_KEYS = new Set(['uppercase', 'lowercase', 'numbers', 'symbols', 'excludeAmbiguous']);
const CHARACTER_GROUP_KEYS = new Set(['uppercase', 'lowercase', 'numbers', 'symbols']);
const STRENGTH_LABELS = ['veryWeak', 'weak', 'fair', 'good', 'strong'];
const COMMON_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  '123456',
  '1234567',
  '12345678',
  '123456789',
  'qwerty',
  'qwerty123',
  'qwertyuiop',
  'letmein',
  'letmein123',
  'welcome',
  'welcome1',
  'admin',
  'admin123',
  'administrator',
  'iloveyou',
  'monkey',
  'dragon',
  'football',
  'baseball',
  'abc123',
  'passw0rd',
  'p@ssw0rd',
  'trustno1',
  'sunshine',
  'princess',
  'login',
  'guest',
  'changeme'
]);
const PASSPHRASE_WORDS = Object.freeze([
  'acorn', 'acorn', 'air', 'amber', 'anchor', 'apple', 'apricot', 'arrow', 'aspen', 'atlas',
  'am', 'an', 'as', 'at', 'be', 'by', 'do', 'go', 'he', 'if', 'in', 'is', 'it', 'me', 'my',
  'no', 'of', 'on', 'or', 'so', 'to', 'up', 'us', 'we',
  'autumn', 'bamboo', 'beacon', 'berry', 'birch', 'bird', 'bloom', 'blue', 'boat', 'book',
  'breeze', 'bridge', 'brook', 'butter', 'cabin', 'cactus', 'candle', 'canyon', 'carrot', 'castle',
  'cedar', 'cherry', 'cloud', 'clover', 'cobalt', 'comet', 'coral', 'cotton', 'cove', 'crane',
  'cream', 'cricket', 'crown', 'cypress', 'daisy', 'dawn', 'delta', 'dove', 'dragon', 'drift',
  'earth', 'echo', 'elm', 'ember', 'falcon', 'fern', 'field', 'finch', 'fire', 'flame',
  'flint', 'forest', 'fox', 'frost', 'garden', 'garlic', 'ginger', 'glacier', 'gold', 'granite',
  'grape', 'grove', 'hazel', 'heather', 'heron', 'hill', 'honey', 'island', 'ivy', 'jade',
  'jasmine', 'jupiter', 'kayak', 'kernel', 'lagoon', 'lake', 'lantern', 'laurel', 'leaf', 'lemon',
  'lilac', 'lily', 'lotus', 'lunar', 'maple', 'marble', 'meadow', 'melody', 'meteor', 'mint',
  'moon', 'morning', 'mountain', 'nebula', 'nest', 'north', 'nutmeg', 'oasis', 'ocean', 'olive',
  'onyx', 'opal', 'orbit', 'orchid', 'otter', 'owl', 'palm', 'pebble', 'peony', 'pepper',
  'pine', 'planet', 'plum', 'pond', 'poppy', 'prairie', 'quartz', 'quill', 'rain', 'raven',
  'reef', 'rice', 'river', 'robin', 'rose', 'sage', 'salt', 'sand', 'seed', 'shadow',
  'shell', 'shore', 'sky', 'sparrow', 'spring', 'spruce', 'star', 'stone', 'storm', 'stream',
  'summer', 'sun', 'sunset', 'swallow', 'sycamore', 'teal', 'thistle', 'thunder', 'tide', 'timber',
  'trail', 'tree', 'tulip', 'valley', 'vine', 'violet', 'walnut', 'water', 'wave', 'willow',
  'wind', 'winter', 'wolf', 'wood', 'wren', 'zephyr', 'amber', 'anchor', 'apple', 'apricot',
  'arbor', 'aspen', 'autumn', 'bamboo', 'basil', 'beacon', 'berry', 'birch', 'blossom', 'bluebell',
  'breeze', 'brook', 'buttercup', 'cactus', 'candle', 'canyon', 'caramel', 'carrot', 'cedar', 'chestnut',
  'clay', 'cloudberry', 'clover', 'coffee', 'comet', 'coral', 'cotton', 'crabapple', 'cranberry', 'crescent',
  'cypress', 'daffodil', 'dahlia', 'daisy', 'dew', 'dogwood', 'elder', 'elm', 'fable', 'feather',
  'fern', 'fiddlehead', 'flax', 'forget', 'foxglove', 'frost', 'garlic', 'gecko', 'ginger', 'glacier',
  'goldfinch', 'granite', 'grape', 'green', 'hazel', 'heather', 'hickory', 'holly', 'honeysuckle', 'hydrangea',
  'iris', 'ivy', 'jade', 'jasmine', 'juniper', 'kale', 'kiwi', 'lavender', 'leaf', 'lemongrass',
  'lilac', 'lily', 'linen', 'lotus', 'mango', 'maple', 'marigold', 'meadow', 'mist', 'moonflower',
  'moss', 'mushroom', 'nectar', 'nutmeg', 'oat', 'olive', 'palm', 'papaya', 'parsley', 'peach',
  'pebble', 'peony', 'pepper', 'pinecone', 'plum', 'poppy', 'pumpkin', 'rain', 'redwood', 'rice',
  'rosemary', 'sage', 'seaweed', 'shadow', 'snapdragon', 'sorrel', 'spruce', 'strawberry', 'sunflower', 'tangerine',
  'thyme', 'tomato', 'tulip', 'valley', 'vanilla', 'verbena', 'vine', 'violet', 'water', 'wheat',
  'willow', 'wind', 'wisteria', 'yarrow', 'yucca', 'zinnia', 'acorn', 'alder', 'almond', 'apricot',
  'arrow', 'aspen', 'bay', 'beach', 'beech', 'bell', 'birch', 'blue', 'bramble', 'breeze',
  'brook', 'cedar', 'cherry', 'clay', 'cloud', 'coral', 'corn', 'cypress', 'daffodil', 'dahlia',
  'dew', 'elm', 'fern', 'field', 'flax', 'flower', 'forest', 'fox', 'garlic', 'grain',
  'grove', 'hazel', 'heather', 'honey', 'iris', 'island', 'ivy', 'jade', 'jasmine', 'juniper',
  'lagoon', 'laurel', 'lavender', 'leaf', 'lemon', 'lilac', 'lily', 'linen', 'lotus', 'maple',
  'marble', 'meadow', 'mint', 'moon', 'moss', 'oak', 'oasis', 'olive', 'orchid', 'palm',
  'pebble', 'peony', 'petal', 'pine', 'plum', 'pond', 'poppy', 'rain', 'reef', 'rice',
  'river', 'rose', 'sage', 'sea', 'seed', 'shore', 'sky', 'snow', 'spring', 'stone',
  'summer', 'sun', 'tea', 'thistle', 'tide', 'trail', 'tree', 'tulip', 'valley', 'vine',
  'violet', 'water', 'wave', 'willow', 'wind', 'winter', 'wood', 'yarrow', 'zinc', 'zone'
]);

class PasswordGeneratorError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PasswordGeneratorError';
    this.code = code;
  }
}

let generatedPassword = null;
let generatorHistory = [];
let activePage = null;

function cryptoApi() {
  const api = globalThis.crypto;
  if (!api || typeof api.getRandomValues !== 'function') {
    throw new PasswordGeneratorError('CRYPTO_UNAVAILABLE', 'Crypto.getRandomValues is unavailable');
  }
  return api;
}

function randomIndex(maxExclusive) {
  if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > 4294967296) {
    throw new PasswordGeneratorError('INVALID_RANDOM_RANGE', 'The random range is invalid');
  }
  const api = cryptoApi();
  if (maxExclusive === 1) {
    api.getRandomValues(new Uint8Array(1));
    return 0;
  }
  if (maxExclusive <= 256) {
    const buffer = new Uint8Array(1);
    const limit = 256 - (256 % maxExclusive);
    do {
      api.getRandomValues(buffer);
    } while (buffer[0] >= limit);
    return buffer[0] % maxExclusive;
  }
  const buffer = new Uint32Array(1);
  const range = 4294967296;
  const limit = range - (range % maxExclusive);
  do {
    api.getRandomValues(buffer);
  } while (buffer[0] >= limit);
  return buffer[0] % maxExclusive;
}

function randomCharacter(characters) {
  if (!Array.isArray(characters) || characters.length === 0) {
    throw new PasswordGeneratorError('EMPTY_CHARACTER_POOL', 'The character pool is empty');
  }
  return characters[randomIndex(characters.length)];
}

function secureShuffle(values) {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1);
    const current = values[index];
    values[index] = values[swapIndex];
    values[swapIndex] = current;
  }
  return values;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clampInteger(value, minimum, maximum, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, Math.round(numeric)));
}

function firstDefined(source, keys, fallback) {
  for (const key of keys) {
    if (source[key] !== undefined) {
      return source[key];
    }
  }
  return fallback;
}

function booleanValue(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true' || value === '1') {
      return true;
    }
    if (value.toLowerCase() === 'false' || value === '0') {
      return false;
    }
  }
  return Boolean(value);
}

function customExclusionText(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? '')).join('');
  }
  if (typeof value === 'boolean') {
    return '';
  }
  return String(value ?? '');
}

function normalizeOptions(options = {}) {
  const source = isObject(options) ? options : {};
  const groups = isObject(source.groups) ? source.groups : {};
  const requestedMode = String(firstDefined(source, ['mode', 'type'], '')).toLowerCase();
  const passphraseEnabled = booleanValue(firstDefined(source, ['passphrase', 'isPassphrase'], false), false);
  const mode = ['passphrase', 'phrase', 'words'].includes(requestedMode) || passphraseEnabled ? 'passphrase' : 'password';
  const customValue = firstDefined(source, ['customExclusions', 'excludeCustomCharacters', 'excludedCharacters', 'excludeCustom'], '');
  const separatorValue = Array.from(String(firstDefined(source, ['separator', 'passphraseSeparator'], DEFAULT_OPTIONS.separator)))[0] || '';
  return {
    mode,
    length: clampInteger(firstDefined(source, ['length', 'passwordLength'], DEFAULT_OPTIONS.length), MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH, DEFAULT_OPTIONS.length),
    uppercase: booleanValue(firstDefined(groups, ['uppercase', 'upper'], firstDefined(source, ['uppercase', 'upper'], DEFAULT_OPTIONS.uppercase)), DEFAULT_OPTIONS.uppercase),
    lowercase: booleanValue(firstDefined(groups, ['lowercase', 'lower'], firstDefined(source, ['lowercase', 'lower'], DEFAULT_OPTIONS.lowercase)), DEFAULT_OPTIONS.lowercase),
    numbers: booleanValue(firstDefined(groups, ['numbers', 'number'], firstDefined(source, ['numbers', 'number'], DEFAULT_OPTIONS.numbers)), DEFAULT_OPTIONS.numbers),
    symbols: booleanValue(firstDefined(groups, ['symbols', 'symbol'], firstDefined(source, ['symbols', 'symbol'], DEFAULT_OPTIONS.symbols)), DEFAULT_OPTIONS.symbols),
    excludeAmbiguous: booleanValue(firstDefined(source, ['excludeAmbiguous', 'ambiguous'], DEFAULT_OPTIONS.excludeAmbiguous), DEFAULT_OPTIONS.excludeAmbiguous),
    customExclusions: customExclusionText(customValue),
    wordCount: clampInteger(firstDefined(source, ['wordCount', 'passphraseWords', 'words'], DEFAULT_OPTIONS.wordCount), MIN_PASSPHRASE_WORDS, MAX_PASSPHRASE_WORDS, DEFAULT_OPTIONS.wordCount),
    numberDigits: clampInteger(firstDefined(source, ['numberDigits', 'passphraseNumbers'], DEFAULT_OPTIONS.numberDigits), 1, 4, DEFAULT_OPTIONS.numberDigits),
    separator: separatorValue
  };
}

function buildExclusionSet(config) {
  const exclusions = new Set(Array.from(config.customExclusions));
  if (config.excludeAmbiguous) {
    for (const character of AMBIGUOUS) {
      exclusions.add(character);
    }
  }
  return exclusions;
}

function filterPool(pool, exclusions) {
  return Array.from(pool).filter((character) => !exclusions.has(character));
}

function selectedPools(config) {
  const exclusions = buildExclusionSet(config);
  const pools = {
    uppercase: config.uppercase ? filterPool(UPPERCASE, exclusions) : [],
    lowercase: config.lowercase ? filterPool(LOWERCASE, exclusions) : [],
    numbers: config.numbers ? filterPool(NUMBERS, exclusions) : [],
    symbols: config.symbols ? filterPool(SYMBOLS, exclusions) : []
  };
  const enabled = [config.uppercase, config.lowercase, config.numbers, config.symbols];
  if (!enabled.some(Boolean)) {
    throw new PasswordGeneratorError('CHARACTER_GROUP_REQUIRED', 'At least one character group is required');
  }
  if (Object.values(pools).some((pool, index) => enabled[index] && pool.length === 0)) {
    throw new PasswordGeneratorError('EMPTY_CHARACTER_POOL', 'Custom exclusions removed a selected character group');
  }
  return pools;
}

function randomNumber(pool, digitCount) {
  let value = '';
  for (let index = 0; index < digitCount; index += 1) {
    value += randomCharacter(pool);
  }
  return value;
}

function createRandomPassword(config, pools) {
  const groups = [pools.uppercase, pools.lowercase, pools.numbers, pools.symbols].filter((pool) => pool.length > 0);
  const combined = groups.flatMap((pool) => pool);
  const characters = [];
  const required = Math.min(config.length, groups.length);
  for (let index = 0; index < required; index += 1) {
    characters.push(randomCharacter(groups[index]));
  }
  for (let index = required; index < config.length; index += 1) {
    characters.push(randomCharacter(combined));
  }
  secureShuffle(characters);
  return characters.join('');
}

function transformPassphraseWord(word, config) {
  if (config.uppercase && !config.lowercase) {
    return word.toUpperCase();
  }
  if (config.uppercase && config.lowercase) {
    return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
  }
  return word.toLowerCase();
}

function passphraseWordPool(config, exclusions) {
  return PASSPHRASE_WORDS
    .map((word) => transformPassphraseWord(word, config))
    .filter((word, index, words) => word.length > 0 && words.indexOf(word) === index)
    .filter((word) => Array.from(word).every((character) => !exclusions.has(character)));
}

function selectPassphraseWords(words, count) {
  const indexes = words.map((word, index) => index);
  const amount = Math.min(count, words.length);
  for (let index = 0; index < amount; index += 1) {
    const swapIndex = index + randomIndex(indexes.length - index);
    const current = indexes[index];
    indexes[index] = indexes[swapIndex];
    indexes[swapIndex] = current;
  }
  return indexes.slice(0, amount).map((index) => words[index]);
}

function choosePassphraseSeparator(config, exclusions) {
  if (!config.symbols) {
    return exclusions.has(' ') ? '' : ' ';
  }
  const candidates = Array.from(new Set([config.separator, '-', '_', '.'])).filter((separator) => separator && !Array.from(separator).some((character) => exclusions.has(character)));
  if (candidates.length === 0) {
    return '';
  }
  return randomCharacter(candidates);
}

function composePassphrase(words, number, symbol, separator) {
  const parts = [];
  if (number) {
    if (words.length > 1) {
      parts.push(words[0], words[1], number, ...words.slice(2));
    } else {
      parts.push(words[0], number);
    }
  } else {
    parts.push(...words);
  }
  if (symbol) {
    parts.push(symbol);
  }
  return parts.join(separator);
}

function createPassphrase(config, pools) {
  const exclusions = buildExclusionSet(config);
  const words = passphraseWordPool(config, exclusions);
  if (words.length === 0) {
    throw new PasswordGeneratorError('EMPTY_PASSPHRASE_POOL', 'Custom exclusions removed every passphrase word');
  }
  let separator = choosePassphraseSeparator(config, exclusions);
  let number = config.numbers ? randomNumber(pools.numbers, config.numberDigits) : '';
  let symbol = config.symbols ? randomCharacter(pools.symbols) : '';
  let selectedWords = selectPassphraseWords(words, config.wordCount);
  let result = composePassphrase(selectedWords, number, symbol, separator);
  while (result.length > config.length && selectedWords.length > 1) {
    selectedWords = selectedWords.slice(0, -1);
    result = composePassphrase(selectedWords, number, symbol, separator);
  }
  if (result.length > config.length && symbol) {
    symbol = '';
    result = composePassphrase(selectedWords, number, symbol, separator);
  }
  if (result.length > config.length && number.length > 1) {
    number = randomNumber(pools.numbers, 1);
    result = composePassphrase(selectedWords, number, symbol, separator);
  }
  if (result.length > config.length && selectedWords.length > 1) {
    selectedWords = selectedWords.slice(0, 1);
    result = composePassphrase(selectedWords, number, symbol, separator);
  }
  if (result.length > config.length && separator) {
    separator = '';
    result = composePassphrase(selectedWords, number, symbol, separator);
  }
  if (result.length > config.length) {
    const fittingWords = words.filter((word) => word.length + (number ? 1 : 0) <= config.length);
    if (fittingWords.length === 0) {
      throw new PasswordGeneratorError('INVALID_PASSPHRASE_LENGTH', 'The passphrase length is too short');
    }
    selectedWords = [fittingWords[randomIndex(fittingWords.length)]];
    result = composePassphrase(selectedWords, number, symbol, separator);
  }
  if (config.symbols && !/[^\p{L}\p{N}\s]/u.test(result)) {
    number = config.numbers ? randomNumber(pools.numbers, 1) : '';
    symbol = randomCharacter(pools.symbols);
    separator = '';
    const fixedLength = number.length + symbol.length;
    const minimumWordLength = Math.max(1, MIN_PASSWORD_LENGTH - fixedLength);
    const fittingWords = words.filter((word) => word.length >= minimumWordLength && word.length + fixedLength <= config.length);
    if (fittingWords.length === 0) {
      throw new PasswordGeneratorError('INVALID_PASSPHRASE_LENGTH', 'The passphrase length is too short');
    }
    selectedWords = [fittingWords[randomIndex(fittingWords.length)]];
    result = composePassphrase(selectedWords, number, symbol, separator);
  }
  if (config.numbers && !/\p{N}/u.test(result)) {
    throw new PasswordGeneratorError('INVALID_PASSPHRASE_LENGTH', 'The passphrase length is too short');
  }
  if (config.uppercase && !/\p{Lu}/u.test(result)) {
    throw new PasswordGeneratorError('INVALID_PASSPHRASE_LENGTH', 'The passphrase length is too short');
  }
  if (config.lowercase && !/\p{Ll}/u.test(result)) {
    throw new PasswordGeneratorError('INVALID_PASSPHRASE_LENGTH', 'The passphrase length is too short');
  }
  if (result.length < MIN_PASSWORD_LENGTH) {
    if (number) {
      number = randomNumber(pools.numbers, Math.min(4, Math.max(1, MIN_PASSWORD_LENGTH - selectedWords[0].length - separator.length)));
      result = composePassphrase(selectedWords, number, symbol, separator);
    } else {
      const fittingWords = words.filter((word) => word.length >= MIN_PASSWORD_LENGTH && word.length <= config.length);
      if (fittingWords.length > 0) {
        selectedWords = [fittingWords[randomIndex(fittingWords.length)]];
        result = composePassphrase(selectedWords, number, symbol, separator);
      } else {
        const shortWords = words.filter((word) => word.length <= 2);
        if (shortWords.length < 2) {
          throw new PasswordGeneratorError('INVALID_PASSPHRASE_LENGTH', 'The passphrase length is too short');
        }
        selectedWords = [shortWords[randomIndex(shortWords.length)], shortWords[randomIndex(shortWords.length)]];
        separator = '';
        result = composePassphrase(selectedWords, number, symbol, separator);
      }
    }
  }
  if (result.length > config.length || result.length < MIN_PASSWORD_LENGTH) {
    throw new PasswordGeneratorError('INVALID_PASSPHRASE_LENGTH', 'The passphrase length is too short');
  }
  return result;
}

export function generatePassword(options = {}) {
  const config = normalizeOptions(options);
  const pools = selectedPools(config);
  const value = config.mode === 'passphrase'
    ? createPassphrase(config, pools)
    : createRandomPassword(config, pools);
  generatedPassword = value;
  generatorHistory.unshift(value);
  if (generatorHistory.length > MAX_HISTORY) {
    generatorHistory.length = MAX_HISTORY;
  }
  return value;
}

export function calculatePasswordStrength(password) {
  if (typeof password !== 'string' || password.length === 0) {
    return {
      score: 0,
      percent: 0,
      label: 'veryWeak',
      checks: {
        length: false,
        lowercase: false,
        uppercase: false,
        number: false,
        symbol: false,
        uncommon: true
      }
    };
  }
  const characters = Array.from(password);
  const lowercase = /\p{Ll}/u.test(password);
  const uppercase = /\p{Lu}/u.test(password);
  const number = /\p{N}/u.test(password);
  const symbol = /[^\p{L}\p{N}\s]/u.test(password);
  const otherLetter = /\p{L}/u.test(password) && !lowercase && !uppercase;
  const categories = [lowercase || otherLetter, uppercase, number, symbol].filter(Boolean).length;
  const effectivePool = (lowercase || otherLetter ? 26 : 0) + (uppercase ? 26 : 0) + (number ? 10 : 0) + (symbol ? 40 : 0) + (otherLetter ? 20 : 0);
  const normalized = password.toLocaleLowerCase();
  const canonical = normalized.replace(/[^\p{L}\p{N}]+/gu, '');
  const common = COMMON_PASSWORDS.has(normalized) || COMMON_PASSWORDS.has(canonical);
  const repeated = /(.)\1{2}/u.test(password);
  const sequential = /(?:0123|1234|2345|3456|4567|5678|6789|9876|8765|7654|6543|5432|4321|abcd|bcde|cdef|qwerty|qwert|asdf|sdfg|zxcv)/i.test(password);
  const uniqueRatio = new Set(characters).size / characters.length;
  let entropy = characters.length * Math.log2(Math.max(2, effectivePool));
  if (uniqueRatio < 0.45) {
    entropy -= 16;
  }
  if (repeated) {
    entropy -= 12;
  }
  if (sequential) {
    entropy -= 14;
  }
  if (common) {
    entropy *= 0.35;
  }
  let score = entropy >= 96 ? 4 : entropy >= 72 ? 3 : entropy >= 48 ? 2 : entropy >= 28 ? 1 : 0;
  if (characters.length < 8 || categories < 2 || common) {
    score = Math.min(score, 1);
  }
  if (uniqueRatio < 0.45 || repeated || sequential) {
    score -= 1;
  }
  score = Math.min(4, Math.max(0, score));
  return {
    score,
    percent: score * 25,
    label: STRENGTH_LABELS[score],
    checks: {
      length: characters.length >= 8,
      lowercase,
      uppercase,
      number,
      symbol,
      uncommon: !common
    }
  };
}

export function getGeneratedPassword() {
  return generatedPassword;
}

export function consumeGeneratedPassword() {
  const value = generatedPassword;
  generatedPassword = null;
  return value;
}

export function getGeneratorHistory() {
  return generatorHistory.slice();
}

export function setPendingCredentialPassword(password) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new TypeError('A non-empty password is required');
  }
  return password;
}

function optionMarkup(setting, iconName, titleKey, hintKey) {
  const title = escapeHTML(t(titleKey));
  const hint = escapeHTML(t(hintKey));
  return `
    <label class="option-row">
      <span class="option-label">
        <span class="option-icon">${icon(iconName)}</span>
        <span><strong data-i18n="${titleKey}">${title}</strong><small data-i18n="${hintKey}">${hint}</small></span>
      </span>
      <span class="switch">
        <input id="generator-${setting}" name="generator-${setting}" type="checkbox" data-generator-setting="${setting}" aria-label="${title}" data-i18n-aria-label="${titleKey}">
        <span class="switch-slider" aria-hidden="true"></span>
      </span>
    </label>`;
}

function createGeneratorMarkup() {
  return `
    <div class="generator-page" data-generator-root>
      <header class="feature-page-header">
        <div class="feature-page-header-copy">
          <h2 data-i18n="generator.title">${escapeHTML(t('generator.title'))}</h2>
          <p data-i18n="generator.subtitle">${escapeHTML(t('generator.subtitle'))}</p>
        </div>
        <button class="button button-primary" type="button" data-generator-action="generate">
          ${icon('wand', 'button__icon')}<span data-i18n="generator.generateNew">${escapeHTML(t('generator.generateNew'))}</span>
        </button>
      </header>
      <div class="generator-layout">
        <section class="card generator-output-card" aria-labelledby="generator-output-label">
          <div class="generator-output-header">
            <span class="generator-output-label" id="generator-output-label" data-i18n="generator.generatedPassword">${escapeHTML(t('generator.generatedPassword'))}</span>
            <span class="generator-result-label"><span class="status-dot" aria-hidden="true"></span><span data-generator-mode-label data-i18n="generator.passwordMode">${escapeHTML(t('generator.passwordMode'))}</span></span>
          </div>
          <div class="generator-output" data-generator-output dir="ltr" role="textbox" aria-readonly="true" aria-live="polite" tabindex="0"></div>
          <div class="generator-output-actions">
            <button class="button button-secondary" type="button" data-generator-action="copy">
              ${icon('copy', 'button__icon')}<span data-i18n="generator.copyPassword">${escapeHTML(t('generator.copyPassword'))}</span>
            </button>
            <button class="button button-primary" type="button" data-generator-action="use">
              ${icon('key', 'button__icon')}<span data-i18n="generator.useInCredential">${escapeHTML(t('generator.useInCredential'))}</span>
            </button>
          </div>
          <div class="auth-strength-wrap">
            <div class="strength-meta">
              <span class="strength-label" data-i18n="generator.passwordStrength">${escapeHTML(t('generator.passwordStrength'))}</span>
              <span data-generator-strength-label>${escapeHTML(t('auth.strengthPending'))}</span>
            </div>
            <div class="strength-track" data-generator-strength-track data-strength="veryWeak" role="progressbar" aria-valuemin="0" aria-valuemax="4" aria-valuenow="0">
              <span class="strength-fill" data-generator-strength-fill></span>
            </div>
          </div>
        </section>
        <section class="card generator-controls-card" aria-labelledby="generator-controls-label">
          <div class="section-header">
            <h3 id="generator-controls-label" data-i18n="generator.mode">${escapeHTML(t('generator.mode'))}</h3>
          </div>
          <div class="form-field">
            <label class="field-label" for="generator-mode" data-i18n="generator.mode">${escapeHTML(t('generator.mode'))}</label>
            <div class="select-control">
              <select id="generator-mode" name="generator-mode" data-generator-setting="mode">
                <option value="password" data-i18n="generator.passwordMode">${escapeHTML(t('generator.passwordMode'))}</option>
                <option value="passphrase" data-i18n="generator.passphraseMode">${escapeHTML(t('generator.passphraseMode'))}</option>
              </select>
            </div>
          </div>
          <div class="length-control">
            <label class="field-label" for="generator-length" data-i18n="generator.length">${escapeHTML(t('generator.length'))}</label>
            <output class="length-value" data-generator-length-value for="generator-length">16</output>
            <input class="length-range" id="generator-length" name="generator-length" type="range" min="4" max="64" step="1" value="16" data-generator-setting="length">
          </div>
          <div class="range-meta" aria-hidden="true">
            <span>${escapeHTML(t('generator.lengthCharacters', { name: 4 }))}</span>
            <span>${escapeHTML(t('generator.lengthCharacters', { name: 64 }))}</span>
          </div>
          <p class="field-hint" data-i18n="generator.lengthHint">${escapeHTML(t('generator.lengthHint'))}</p>
          <div class="length-control" data-passphrase-only hidden>
            <label class="field-label" for="generator-word-count" data-i18n="generator.passphraseMode">${escapeHTML(t('generator.passphraseMode'))}</label>
            <output class="length-value" data-generator-word-count-value for="generator-word-count">4</output>
            <input class="length-range" id="generator-word-count" name="generator-word-count" type="range" min="2" max="8" step="1" value="4" data-generator-setting="wordCount">
          </div>
          <div class="option-list">
            ${optionMarkup('uppercase', 'key', 'generator.uppercase', 'generator.uppercaseHint')}
            ${optionMarkup('lowercase', 'shield', 'generator.lowercase', 'generator.lowercaseHint')}
            ${optionMarkup('numbers', 'activity', 'generator.numbers', 'generator.numbersHint')}
            ${optionMarkup('symbols', 'sparkles', 'generator.symbols', 'generator.symbolsHint')}
            ${optionMarkup('excludeAmbiguous', 'eye-off', 'generator.excludeAmbiguous', 'generator.excludeAmbiguousHint')}
          </div>
          <div class="form-field">
            <label class="field-label" for="generator-custom-exclusions" data-i18n="generator.excludeCustom">${escapeHTML(t('generator.excludeCustom'))}</label>
            <div class="input-control">
              <input id="generator-custom-exclusions" name="generator-custom-exclusions" type="text" autocomplete="off" spellcheck="false" data-generator-setting="customExclusions" placeholder="${escapeHTML(t('generator.excludeCustomPlaceholder'))}" data-i18n-placeholder="generator.excludeCustomPlaceholder">
            </div>
          </div>
          <div class="info-strip" data-passphrase-only hidden>
            ${icon('info')}<span data-i18n="generator.passphraseHint">${escapeHTML(t('generator.passphraseHint'))}</span>
          </div>
          <p class="form-error" data-generator-validation role="alert" aria-live="assertive" hidden></p>
          <p class="generator-note" data-i18n="generator.generatorNote">${escapeHTML(t('generator.generatorNote'))}</p>
        </section>
      </div>
      <section class="card generator-controls-card" aria-labelledby="generator-history-label">
        <div class="section-header">
          <h3 id="generator-history-label" data-i18n="generator.recentPasswords">${escapeHTML(t('generator.recentPasswords'))}</h3>
          <button class="button button-quiet button-small" type="button" data-generator-action="clear-history" data-generator-clear-history>
            ${icon('trash', 'button__icon')}<span data-i18n="generator.clearHistory">${escapeHTML(t('generator.clearHistory'))}</span>
          </button>
        </div>
        <div class="sync-history-list recent-list" data-generator-history aria-live="polite"></div>
      </section>
    </div>`;
}

function pageElements(container) {
  const root = container.querySelector('[data-generator-root]');
  return {
    root,
    output: root.querySelector('[data-generator-output]'),
    modeLabel: root.querySelector('[data-generator-mode-label]'),
    strengthLabel: root.querySelector('[data-generator-strength-label]'),
    strengthTrack: root.querySelector('[data-generator-strength-track]'),
    strengthFill: root.querySelector('[data-generator-strength-fill]'),
    validation: root.querySelector('[data-generator-validation]'),
    history: root.querySelector('[data-generator-history]'),
    clearHistory: root.querySelector('[data-generator-clear-history]'),
    length: root.querySelector('[data-generator-setting="length"]'),
    lengthValue: root.querySelector('[data-generator-length-value]'),
    wordCount: root.querySelector('[data-generator-setting="wordCount"]'),
    wordCountValue: root.querySelector('[data-generator-word-count-value]'),
    mode: root.querySelector('[data-generator-setting="mode"]'),
    customExclusions: root.querySelector('[data-generator-setting="customExclusions"]')
  };
}

function addPageListener(page, target, type, handler, options) {
  if (!target || typeof target.addEventListener !== 'function') {
    return;
  }
  target.addEventListener(type, handler, options);
  page.listeners.push({ target, type, handler, options });
}

function removeChildren(element) {
  while (element?.firstChild) {
    element.removeChild(element.firstChild);
  }
}

function applyModeVisibility(page) {
  const passphrase = page.settings.mode === 'passphrase';
  for (const element of page.root.querySelectorAll('[data-passphrase-only]')) {
    element.hidden = !passphrase;
  }
  const key = passphrase ? 'generator.passphraseMode' : 'generator.passwordMode';
  page.elements.modeLabel.dataset.i18n = key;
  page.elements.modeLabel.textContent = t(key);
}

function applySettingsToControls(page) {
  for (const input of page.root.querySelectorAll('input[type="checkbox"][data-generator-setting]')) {
    input.checked = Boolean(page.settings[input.dataset.generatorSetting]);
  }
  page.elements.length.value = String(page.settings.length);
  page.elements.lengthValue.textContent = String(page.settings.length);
  page.elements.length.setAttribute('aria-valuetext', t('generator.lengthCharacters', { name: page.settings.length }));
  page.elements.wordCount.value = String(page.settings.wordCount);
  page.elements.wordCountValue.textContent = String(page.settings.wordCount);
    page.elements.wordCount.setAttribute('aria-valuetext', `${t('generator.passphraseMode')}: ${page.settings.wordCount}`);
  page.elements.mode.value = page.settings.mode;
  page.elements.customExclusions.value = page.settings.customExclusions;
  applyModeVisibility(page);
}

function updateStrength(page, value) {
  const estimate = calculatePasswordStrength(value);
  const label = value ? t(`generator.${estimate.label}`) : t('auth.strengthPending');
  page.elements.strengthLabel.textContent = label;
  page.elements.strengthLabel.dataset.i18n = value ? `generator.${estimate.label}` : 'auth.strengthPending';
  page.elements.strengthFill.style.width = `${estimate.percent}%`;
  page.elements.strengthTrack.dataset.strength = estimate.label;
  page.elements.strengthTrack.dataset.level = estimate.label;
  page.elements.strengthTrack.setAttribute('aria-valuenow', String(estimate.score));
  page.elements.strengthTrack.setAttribute('aria-valuetext', label);
}

function renderHistory(page) {
  const doc = page.container.ownerDocument;
  removeChildren(page.elements.history);
  page.elements.clearHistory.disabled = generatorHistory.length === 0;
  if (generatorHistory.length === 0) {
    const empty = doc.createElement('p');
    empty.className = 'muted-text';
    empty.dataset.i18n = 'generator.noRecentPasswords';
    empty.textContent = t('generator.noRecentPasswords');
    page.elements.history.appendChild(empty);
    return;
  }
  generatorHistory.forEach((value, index) => {
    const row = doc.createElement('div');
    row.className = 'sync-history-item generator-recent-item';
    const clock = doc.createElement('span');
    clock.className = 'option-icon';
    clock.setAttribute('aria-hidden', 'true');
    clock.innerHTML = icon('clock');
    const copy = doc.createElement('div');
    copy.className = 'sync-history-item-copy';
    const password = doc.createElement('strong');
    password.className = 'mono-text';
    password.dir = 'ltr';
    password.textContent = value;
    const strength = doc.createElement('small');
    const estimate = calculatePasswordStrength(value);
    strength.dataset.i18n = `generator.${estimate.label}`;
    strength.textContent = t(`generator.${estimate.label}`);
    copy.append(password, strength);
    const button = doc.createElement('button');
    button.className = 'icon-button';
    button.type = 'button';
    button.dataset.generatorAction = 'history-copy';
    button.dataset.historyIndex = String(index);
    button.setAttribute('aria-label', t('generator.copyFirst'));
    button.setAttribute('title', t('generator.copyFirst'));
    button.dataset.i18nAriaLabel = 'generator.copyFirst';
    button.dataset.i18nTitle = 'generator.copyFirst';
    button.innerHTML = icon('copy');
    row.append(clock, copy, button);
    page.elements.history.appendChild(row);
  });
}

function validationKey(config) {
  try {
    const normalized = normalizeOptions(config);
    const pools = selectedPools(normalized);
    if (normalized.mode === 'passphrase') {
      const words = passphraseWordPool(normalized, buildExclusionSet(normalized));
      if (words.length === 0) {
        return 'validation.invalidCharacter';
      }
      if (normalized.numbers && pools.numbers.length === 0) {
        return 'validation.invalidCharacter';
      }
    }
    return '';
  } catch (error) {
    return error?.code === 'CHARACTER_GROUP_REQUIRED' ? 'validation.atLeastOneOption' : 'validation.invalidCharacter';
  }
}

function setValidation(page, key) {
  page.elements.validation.hidden = !key;
  page.elements.validation.textContent = key ? t(key) : '';
  if (key) {
    page.elements.validation.dataset.i18n = key;
  } else {
    delete page.elements.validation.dataset.i18n;
  }
}

function refreshValidation(page) {
  setValidation(page, validationKey(page.settings));
}

function persistedSettings(settings) {
  return {
    mode: settings.mode,
    length: settings.length,
    uppercase: settings.uppercase,
    lowercase: settings.lowercase,
    numbers: settings.numbers,
    symbols: settings.symbols,
    excludeAmbiguous: settings.excludeAmbiguous,
    customExclusions: settings.customExclusions,
    wordCount: settings.wordCount
  };
}

function scheduleSettingsSave(page) {
  const value = persistedSettings(page.settings);
  page.saveQueue = page.saveQueue
    .catch(() => undefined)
    .then(() => saveSetting('passwordGeneratorDefaults', value));
  page.saveQueue.catch(() => {
    if (activePage === page) {
      showToast(t('toast.operationFailed'), 'error');
    }
  });
}

function generateCurrent(page) {
  try {
    const value = generatePassword(page.settings);
    page.elements.output.textContent = value;
    updateStrength(page, value);
    setValidation(page, '');
    renderHistory(page);
    return true;
  } catch {
    consumeGeneratedPassword();
    page.elements.output.textContent = '';
    updateStrength(page, '');
    setValidation(page, validationKey(page.settings));
    showToast(t('toast.operationFailed'), 'error');
    return false;
  }
}

async function copyValue(value) {
  if (!value) {
    showToast(t('toast.operationFailed'), 'error');
    return false;
  }
  try {
    const copied = await copyText(value);
    showToast(t(copied ? 'generator.copied' : 'toast.operationFailed'), copied ? 'success' : 'error');
    return copied;
  } catch {
    showToast(t('toast.operationFailed'), 'error');
    return false;
  }
}

function dispatchCredentialNavigation(password) {
  if (typeof globalThis.dispatchEvent !== 'function') {
    return false;
  }
  let event;
  if (typeof globalThis.CustomEvent === 'function') {
    event = new globalThis.CustomEvent('hsa-navigate-to-credentials', { detail: { password } });
  } else if (typeof globalThis.Event === 'function') {
    event = new globalThis.Event('hsa-navigate-to-credentials');
    Object.defineProperty(event, 'detail', { value: { password } });
  } else {
    return false;
  }
  globalThis.dispatchEvent(event);
  return true;
}

function useCurrentPassword() {
  const value = generatedPassword;
  if (!value) {
    showToast(t('toast.operationFailed'), 'error');
    return;
  }
  setPendingCredentialPassword(value);
  if (!dispatchCredentialNavigation(value)) {
    showToast(t('toast.operationFailed'), 'error');
  }
}

function handlePageClick(page, event) {
  const button = event.target?.closest?.('[data-generator-action]');
  if (!button || !page.root.contains(button)) {
    return;
  }
  event.preventDefault();
  const action = button.dataset.generatorAction;
  if (action === 'generate') {
    generateCurrent(page);
    return;
  }
  if (action === 'copy') {
    void copyValue(generatedPassword);
    return;
  }
  if (action === 'use') {
    useCurrentPassword();
    return;
  }
  if (action === 'history-copy') {
    const index = Number(button.dataset.historyIndex);
    void copyValue(Number.isInteger(index) ? generatorHistory[index] : null);
    return;
  }
  if (action === 'clear-history') {
    generatorHistory = [];
    renderHistory(page);
  }
}

function handlePageInput(page, event) {
  const input = event.target?.closest?.('[data-generator-setting]');
  if (!input || input.type === 'checkbox' || !page.root.contains(input)) {
    return;
  }
  const key = input.dataset.generatorSetting;
  if (!OPTION_KEYS.has(key)) {
    return;
  }
  if (key === 'length') {
    page.settings.length = clampInteger(input.value, MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH, page.settings.length);
    page.elements.lengthValue.textContent = String(page.settings.length);
    page.elements.length.setAttribute('aria-valuetext', t('generator.lengthCharacters', { name: page.settings.length }));
  } else if (key === 'wordCount') {
    page.settings.wordCount = clampInteger(input.value, MIN_PASSPHRASE_WORDS, MAX_PASSPHRASE_WORDS, page.settings.wordCount);
    page.elements.wordCountValue.textContent = String(page.settings.wordCount);
  page.elements.wordCount.setAttribute('aria-valuetext', `${t('generator.passphraseMode')}: ${page.settings.wordCount}`);
  } else if (key === 'mode') {
    page.settings.mode = input.value === 'passphrase' ? 'passphrase' : 'password';
    applyModeVisibility(page);
  } else if (key === 'customExclusions') {
    page.settings.customExclusions = input.value;
  }
  refreshValidation(page);
}

function handlePageChange(page, event) {
  const input = event.target?.closest?.('[data-generator-setting]');
  if (!input || !page.root.contains(input)) {
    return;
  }
  const key = input.dataset.generatorSetting;
  if (!OPTION_KEYS.has(key)) {
    return;
  }
  if (input.type === 'checkbox' && BOOLEAN_KEYS.has(key)) {
    const toggles = [...page.root.querySelectorAll('input[type="checkbox"][data-generator-setting]')]
      .filter((toggle) => CHARACTER_GROUP_KEYS.has(toggle.dataset.generatorSetting));
    if (!input.checked && !toggles.some((toggle) => toggle.checked)) {
      input.checked = true;
      setValidation(page, 'validation.atLeastOneOption');
      return;
    }
    page.settings[key] = input.checked;
  } else {
    handlePageInput(page, event);
  }
  refreshValidation(page);
  scheduleSettingsSave(page);
}

function wipeGeneratorState() {
  generatedPassword = null;
  generatorHistory = [];
}

function disposePage(page) {
  if (!page) {
    return;
  }
  for (const listener of page.listeners.splice(0).reverse()) {
    listener.target.removeEventListener(listener.type, listener.handler, listener.options);
  }
  page.elements.output.textContent = '';
  removeChildren(page.elements.history);
  page.settings = null;
  wipeGeneratorState();
}

export function disposeGeneratorPage() {
  const page = activePage;
  activePage = null;
  disposePage(page);
  wipeGeneratorState();
}

function handleSessionClose() {
  disposeGeneratorPage();
}

if (typeof globalThis.addEventListener === 'function') {
  globalThis.addEventListener('hsa-auth-locked', handleSessionClose);
  globalThis.addEventListener('hsa-session-close', handleSessionClose);
  globalThis.addEventListener('pagehide', handleSessionClose);
}

export async function renderGeneratorPage(container, context = {}) {
  disposeGeneratorPage();
  if (!container || container.nodeType !== 1) {
    throw new TypeError('A generator page container is required');
  }
  if (context?.signal?.aborted) {
    return null;
  }
  container.innerHTML = createGeneratorMarkup();
  const page = {
    container,
    root: container.querySelector('[data-generator-root]'),
    elements: pageElements(container),
    settings: normalizeOptions(DEFAULT_OPTIONS),
    listeners: [],
    saveQueue: Promise.resolve()
  };
  activePage = page;
  applySettingsToControls(page);
  refreshValidation(page);
  updateStrength(page, '');
  renderHistory(page);
  addPageListener(page, page.root, 'click', (event) => handlePageClick(page, event));
  addPageListener(page, page.root, 'input', (event) => handlePageInput(page, event));
  addPageListener(page, page.root, 'change', (event) => handlePageChange(page, event));
  if (context?.signal && typeof context.signal.addEventListener === 'function') {
    addPageListener(page, context.signal, 'abort', disposeGeneratorPage, { once: true });
  }
  try {
    const stored = await getSetting('passwordGeneratorDefaults');
    if (activePage !== page) {
      return container;
    }
    if (isObject(stored)) {
      page.settings = normalizeOptions(stored);
      applySettingsToControls(page);
    }
  } catch {
    if (activePage === page) {
      showToast(t('toast.operationFailed'), 'error');
    }
  }
  if (activePage !== page) {
    return container;
  }
  refreshValidation(page);
  generateCurrent(page);
  return container;
}
