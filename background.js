// Background Service Worker - Handles API calls to bypass CORS
// Uses api.imdbapi.dev (no API key required)

const API_BASE = 'https://api.imdbapi.dev';
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Search for IMDb title ID
 * Correct endpoint: /search/titles?query={titleName}
 */
async function searchIMDb(titleName) {
  try {
    const encodedQuery = encodeURIComponent(titleName.trim());
    const searchUrl = `${API_BASE}/search/titles?query=${encodedQuery}`;

    console.log('[Background] Searching IMDb:', searchUrl);

    const response = await fetch(searchUrl);
    if (!response.ok) throw new Error(`Search failed: ${response.status}`);

    const data = await response.json();
    console.log('[Background] IMDb search response:', data);

    // The API returns `titles` not `results`
    if (data && data.titles && data.titles.length > 0) {
      const imdbId = data.titles[0].id;
      console.log('[Background] Found IMDb ID:', imdbId);
      return imdbId;
    }

    console.warn('[Background] No results found in IMDb search');
    return null;
  } catch (error) {
    console.error('[Background] IMDb search error:', error);
    return null;
  }
}

/**
 * Fetch parental guide data from IMDb
 * Endpoint: /titles/{imdbId}/parentsGuide
 */
async function fetchParentalGuide(imdbId) {
  try {
    const guideUrl = `${API_BASE}/titles/${imdbId}/parentsGuide`;
    console.log('[Background] Fetching parental guide:', guideUrl);

    const response = await fetch(guideUrl);
    if (!response.ok) throw new Error(`Parental guide fetch failed: ${response.status}`);

    const data = await response.json();
    console.log('[Background] Parental guide response:', data);
    return data;
  } catch (error) {
    console.error('[Background] Parental guide fetch error:', error);
    return null;
  }
}

/**
 * Cache utilities
 */
async function getCachedData(netflixId) {
  const result = await chrome.storage.local.get(netflixId);
  const cacheEntry = result[netflixId];
  if (!cacheEntry) return null;

  const age = Date.now() - cacheEntry.timestamp;
  if (age > CACHE_DURATION) {
    await chrome.storage.local.remove(netflixId);
    return null;
  }

  return cacheEntry.data;
}

async function cacheData(netflixId, data) {
  await chrome.storage.local.set({
    [netflixId]: { data, timestamp: Date.now() }
  });
}

/**
 * Main request handler
 */
async function handleParentalGuideRequest(netflixId, title, year) {
  console.log('[Background] Processing:', title, '| Year:', year);

  const cachedData = await getCachedData(netflixId);
  if (cachedData) {
    console.log('[Background] Returning cached data');
    return { success: true, data: cachedData, cached: true };
  }

  // Search IMDb by title only
  const imdbId = await searchIMDb(title);
  if (!imdbId) {
    return {
      success: false,
      error: 'NOT_FOUND',
      message: 'Title not found in IMDb database'
    };
  }

  // Fetch parental guide
  const parentalGuide = await fetchParentalGuide(imdbId);
  if (!parentalGuide) {
    return {
      success: false,
      error: 'NO_DATA',
      message: 'Could not fetch parental guide data'
    };
  }

  await cacheData(netflixId, parentalGuide);
  return { success: true, data: parentalGuide, cached: false };
}

/**
 * Message listener
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getParentalGuide') {
    handleParentalGuideRequest(request.netflixId, request.title, request.year)
      .then(sendResponse)
      .catch(error => {
        console.error('[Background] Error:', error);
        sendResponse({ success: false, error: 'PROCESSING_ERROR', message: error.message });
      });
    return true; // keep channel open for async response
  }
});

console.log('[Background] Service worker ready — using api.imdbapi.dev');
