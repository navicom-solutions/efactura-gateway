export type ProviderCredentials = {
  readonly username: string;
  readonly password: string;
};

export const parseProviderCredentialsHeader = (
  header: string | undefined,
): ProviderCredentials | undefined => {
  if (!header) return undefined;
  const decoded = Buffer.from(header, 'base64').toString('utf8');
  const idx = decoded.indexOf(':');
  if (idx <= 0) return undefined;
  return {
    username: decoded.slice(0, idx),
    password: decoded.slice(idx + 1),
  };
};
