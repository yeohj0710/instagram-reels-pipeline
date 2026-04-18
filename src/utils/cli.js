function normalizeFlag(flag) {
  return flag.startsWith('--') ? flag : `--${flag}`;
}

/**
 * Read one CLI flag value from process.argv.
 * Supports --flag value and --flag=value.
 * @param {string} flag
 * @param {string | null} [fallback]
 * @param {string[]} [argv]
 * @returns {string | null}
 */
export function getArgValue(flag, fallback = null, argv = process.argv.slice(2)) {
  const normalizedFlag = normalizeFlag(flag);

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === normalizedFlag) {
      return argv[index + 1] ?? fallback;
    }

    if (value.startsWith(`${normalizedFlag}=`)) {
      return value.slice(normalizedFlag.length + 1) || fallback;
    }
  }

  return fallback;
}

/**
 * Return whether a CLI flag was passed.
 * @param {string} flag
 * @param {string[]} [argv]
 * @returns {boolean}
 */
export function hasArg(flag, argv = process.argv.slice(2)) {
  const normalizedFlag = normalizeFlag(flag);
  return argv.some((value) => value === normalizedFlag || value.startsWith(`${normalizedFlag}=`));
}

/**
 * Read a repeated or comma-separated CLI flag.
 * @param {string} flag
 * @param {string[]} [argv]
 * @returns {string[]}
 */
export function getArgValues(flag, argv = process.argv.slice(2)) {
  const normalizedFlag = normalizeFlag(flag);
  const values = [];

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === normalizedFlag) {
      const nextValue = argv[index + 1];

      if (typeof nextValue === 'string' && nextValue.trim()) {
        values.push(nextValue);
      }

      continue;
    }

    if (value.startsWith(`${normalizedFlag}=`)) {
      values.push(value.slice(normalizedFlag.length + 1));
    }
  }

  return values
    .flatMap((value) => String(value).split(','))
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * Read an integer CLI flag.
 * @param {string} flag
 * @param {number | null} [fallback]
 * @param {string[]} [argv]
 * @returns {number | null}
 */
export function getIntArg(flag, fallback = null, argv = process.argv.slice(2)) {
  const value = getArgValue(flag, null, argv);

  if (value === null) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
