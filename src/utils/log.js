function formatDetails(details) {
  if (details === undefined) {
    return '';
  }

  if (typeof details === 'string') {
    return ` ${details}`;
  }

  try {
    return ` ${JSON.stringify(details)}`;
  } catch {
    return ` ${String(details)}`;
  }
}

function emit(level, message, details) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] ${message}${formatDetails(details)}`;

  if (level === 'ERROR') {
    console.error(line);
    return;
  }

  console.log(line);
}

export const log = {
  info(message, details) {
    emit('INFO', message, details);
  },
  warn(message, details) {
    emit('WARN', message, details);
  },
  error(message, details) {
    emit('ERROR', message, details);
  }
};
