import { formatDate } from '../domain/dates';

/**
 * The words that go with a recovery key when it is saved, printed or emailed. One place, so the
 * file, the printout and the email all say the same thing.
 */
export function recoveryKeyText(key: string, where: 'desktop' | 'web', createdAt: string | null): string {
  const place = where === 'web'
    ? 'Geranium in your web browser (daydreaminginthecloud.bearynatural.dev/geranium), on the computer or phone where you set it up'
    : 'the Geranium desktop app, on the computer where you set it up';
  return [
    'Geranium recovery key',
    '',
    key,
    '',
    `For: ${place}.`,
    ...(createdAt ? [`Made: ${formatDate(createdAt.slice(0, 10), { long: true })}.`] : []),
    '',
    'What it is for: if you forget your Geranium password or PIN, choose "Forgotten your password?" on the lock screen, enter this key, and choose a new password.',
    '',
    'Keep it private. Anyone who has this key and also your Geranium data (that computer or browser) can open your finances. It does not open backup files; those use their own backup password.',
    '',
    'If this key is ever seen by someone else, make a new one in Settings > Privacy & security. The old key then stops working.',
  ].join('\n');
}

/**
 * A draft email to yourself, opened in your own email app. There is no recipient filled in and
 * Geranium sends nothing itself.
 */
export function recoveryKeyMailto(text: string): string {
  const enc = (s: string) => encodeURIComponent(s.replace(/\r?\n/g, '\r\n'));
  return `mailto:?subject=${enc('Geranium recovery key')}&body=${enc(text)}`;
}
