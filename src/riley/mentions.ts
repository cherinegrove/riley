import { SpaceMember } from '../integrations/google-chat';

const normalise = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, ' ');

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const mentionFor = (name: string, members: SpaceMember[]): string => {
  const wanted = normalise(name);
  const exact = members.find((m) => normalise(m.displayName) === wanted);
  if (exact) return `<${exact.userName}>`;

  const byFirstName = members.filter((m) => normalise(m.displayName).split(' ')[0] === wanted);
  if (byFirstName.length === 1) return `<${byFirstName[0].userName}>`;

  return name;
};

export const mentionizeText = (text: string, members: SpaceMember[]): string => {
  let result = text;
  const longestFirst = [...members].sort((a, b) => b.displayName.length - a.displayName.length);
  for (const member of longestFirst) {
    const pattern = new RegExp(`(?<![<\\w])${escapeRegex(member.displayName)}(?![\\w>])`, 'g');
    result = result.replace(pattern, `<${member.userName}>`);
  }
  return result;
};
