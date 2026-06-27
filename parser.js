const uuidRegex = /(?:recap|recaps)\/([0-9a-fA-F-]{36})/;

/**
 * Maps gameServerName and gameType to mode (Solo, Doubles, Triples, Squads)
 */
function getMode(serverName, gameType) {
  if (serverName) {
    const s = serverName.toUpperCase();
    if (s.includes("BW1")) return "Solo";
    if (s.includes("BW2")) return "Doubles";
    if (s.includes("BW3")) return "Triples";
    if (s.includes("BW4")) return "Squads";
  }
  return gameType || "Unknown";
}

/**
 * Validates recap URL format.
 */
function validateUrl(url) {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes("jartexnetwork.com")) return false;
    return uuidRegex.test(parsed.pathname);
  } catch (e) {
    return false;
  }
}

/**
 * Extracts UUID from URL.
 */
function extractUuid(url) {
  const match = url.match(uuidRegex);
  return match ? match[1] : null;
}

/**
 * Fetches and parses recap data.
 */
async function fetchRecapData(url) {
  if (!validateUrl(url)) {
    throw new Error("Invalid JartexNetwork recap URL format.");
  }

  const uuid = extractUuid(url);
  if (!uuid) {
    throw new Error("Could not extract UUID from recap URL.");
  }

  // We will try fetching the JSON API first, as it's the source of truth
  // and the HTML is usually just a client-rendered React/NextJS skeleton.
  const apiEndpoint = `https://stats.jartexnetwork.com/api/recaps/${uuid}`;
  
  let responseText;
  let isJson = false;
  let parsedJson = null;

  try {
    const apiRes = await fetch(apiEndpoint, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'application/json'
      }
    });
    if (apiRes.ok) {
      const contentType = apiRes.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        parsedJson = await apiRes.json();
        isJson = true;
      }
    }
  } catch (e) {
    // Silent fail, fallback to fetching the main URL
  }

  // If the API endpoint direct fetch didn't succeed, fetch the provided URL
  if (!isJson) {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch recap page (HTTP ${res.status}).`);
    }

    const contentType = res.headers.get('content-type') || '';
    responseText = await res.text();

    if (contentType.includes('application/json') || responseText.trim().startsWith('{')) {
      try {
        parsedJson = JSON.parse(responseText);
        isJson = true;
      } catch (e) {
        // Fallback to HTML parsing if parse fails
      }
    }
  }

  if (isJson && parsedJson) {
    return parseJsonData(parsedJson, uuid);
  }

  // If we got HTML, let's look for __NEXT_DATA__
  if (responseText) {
    const nextDataMatch = responseText.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (nextDataMatch) {
      try {
        const nextData = JSON.parse(nextDataMatch[1]);
        // If data is in pageProps or queries
        const gameData = nextData.props?.pageProps?.gameData || nextData.props?.pageProps?.recapData;
        if (gameData) {
          return parseJsonData(gameData, uuid);
        }
      } catch (e) {
        // ignore
      }
    }

    // Try parsing using regex if it's static HTML (e.g. server-side rendered or custom structure)
    return parseHtmlData(responseText, uuid);
  }

  throw new Error("Could not parse recap data.");
}

function parseJsonData(data, uuid) {
  const map = data.mapName || "Unknown";
  const duration = data.gameDuration || "Unknown";
  const mode = getMode(data.gameServerName, data.gameType);
  const winners = Array.isArray(data.winners) ? data.winners.join(", ") : (data.winners || "None");
  
  const playerNames = Array.isArray(data.users) 
    ? data.users.map(u => u.username)
    : [];
  
  const players = playerNames.length > 0 
    ? `${playerNames.join(", ")} (${playerNames.length})`
    : "None (0)";

  return {
    map,
    duration,
    mode,
    winners,
    players,
    uuid
  };
}

function parseHtmlData(html, uuid) {
  // Regex fallbacks for HTML (in case of server-rendered stats page)
  const mapMatch = html.match(/Map:\s*([^<]+)/i) || html.match(/class=["']map-name["']>([^<]+)/i);
  const durationMatch = html.match(/Duration:\s*([^<]+)/i) || html.match(/class=["']duration["']>([^<]+)/i);
  const modeMatch = html.match(/Mode:\s*([^<]+)/i) || html.match(/class=["']mode["']>([^<]+)/i);
  const winnersMatch = html.match(/Winner(?:s)?:\s*([^<]+)/i) || html.match(/class=["']winners["']>([^<]+)/i);

  const map = mapMatch ? mapMatch[1].trim() : "Unknown";
  const duration = durationMatch ? durationMatch[1].trim() : "Unknown";
  const mode = modeMatch ? modeMatch[1].trim() : "Unknown";
  const winners = winnersMatch ? winnersMatch[1].trim() : "None";

  // Try extracting players list
  // Look for usernames in table cells or list items
  const playersList = [];
  const playerRegex = /class=["']username["']>([^<]+)/gi;
  let match;
  while ((match = playerRegex.exec(html)) !== null) {
    if (!playersList.includes(match[1].trim())) {
      playersList.push(match[1].trim());
    }
  }

  const players = playersList.length > 0 
    ? `${playersList.join(", ")} (${playersList.length})`
    : "None (0)";

  return {
    map,
    duration,
    mode,
    winners,
    players,
    uuid
  };
}

module.exports = {
  validateUrl,
  extractUuid,
  fetchRecapData
};
