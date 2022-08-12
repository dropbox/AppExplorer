export const GITHUB_ORIGIN = /git@github.com:([^/\s]+)\/([^/\s]+)(.git)/;

export function readPermalink(strUrl: string) {
  try {
    const url = new URL(strUrl);

    if (url.origin === "https://github.com") {
      const match = url.pathname.match(/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.*)/);
      if (match) {
        const [, org, repo, hash, location] = match;
        return {
          remote: `git@github.com:${org}/${repo}(.git)`,
          org,
          repo,
          hash,
          location,
          permalink: url.toString(),
        };
      }
    }
  } catch (e) {
    // ignore
  }
  return null;
}

export function makePermalink(remote: string, hash: string, location: string) {
  const github = remote.match(GITHUB_ORIGIN);
  if (github) {
    const [, org, repo] = github;
    return `https://github.com/${org}/${repo}/blob/${hash}/${location}`;
  }

  return null;
}
