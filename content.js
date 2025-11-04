// ============================================================
// Netflix IMDb Parental Guide - Content Script (uses background.js for API)
// ============================================================

(function() {
  'use strict';
  const DEBUG = true;
  const OVERLAY_ID = 'imdb-parental-guide-overlay';
  let currentNetflixId = null;
  let overlayEl = null;
  let isProcessing = false;


  function log(...args) {
    if (DEBUG) console.log('[IMDb PG]', ...args);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function getNetflixTitleId() {
    const url = window.location.href;
    const titleMatch = url.match(/\/title\/(\d+)/);
    if (titleMatch) return titleMatch[1];
    const watchMatch = url.match(/\/watch\/(\d+)/);
    if (watchMatch) return watchMatch[1];
    const jbv = new URLSearchParams(window.location.search).get('jbv');
    if (jbv) return jbv;
    return null;
  }

  function extractTitleInfo() {
    let titleName = null;
    let year = null;

    // Try <title> first
    if (document.title) {
      let t = document.title.replace(/\s*-\s*Netflix.*$/i, '').replace(/^Watch\s+/i, '').trim();
      if (t && t.length < 200) titleName = t;
    }

    // Try Netflix DOM elements
    if (!titleName) {
      const selectors = [
        '.title-title',
        '[data-uia="video-title"]',
        '.previewModal--player-titleTreatment-logo',
        '.title-logo',
        '.previewModal--player-title',
        'h1',
        'h2'
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
          const text = el.alt || el.textContent?.trim();
          if (text && text.length < 200) {
            titleName = text;
            break;
          }
        }
      }
    }

    // Extract year
    const yearEl = document.querySelector('.year, [data-uia="video-year"], .item-year, .title-info-metadata-item');
    if (yearEl) {
      const match = yearEl.textContent.match(/\b(19|20)\d{2}\b/);
      if (match) year = match[0];
    }
    if (!year && titleName) {
      const yMatch = titleName.match(/\((\d{4})\)/);
      if (yMatch) {
        year = yMatch[1];
        titleName = titleName.replace(/\(\d{4}\)/, '').trim();
      }
    }

    log('Extracted Title Info:', { titleName, year });
    return { titleName, year };
  }

  async function fetchParentalGuideFromBackground(netflixId, titleName, year) {
    try {
      log('Requesting parental guide from background...');
      const response = await chrome.runtime.sendMessage({
        action: 'getParentalGuide',
        netflixId,
        title: titleName,
        year
      });
      log('Background responded:', response);
      return response;
    } catch (err) {
      console.error('[IMDb PG] Background communication error:', err);
      return { success: false, error: 'COMM_ERROR', message: err.message };
    }
  }

  function removeOverlay() {
    if (overlayEl && overlayEl.parentNode) overlayEl.remove();
    overlayEl = null;
  }

function createOverlay(result, titleName) {
  console.log('[IMDb PG] Creating overlay...');
  removeOverlay();

  // Create container
  overlayEl = document.createElement('div');
  overlayEl.id = 'imdb-pg-overlay';
  overlayEl.className = 'imdb-pg-overlay';

  let html = `
    <div class="imdb-pg-header">
      <h3>IMDb Parental Guide</h3>
      <button class="imdb-pg-close" aria-label="Close">×</button>
    </div>
    <div class="imdb-pg-content">
  `;

  if (!result.success || !result.data?.parentsGuide) {
    html += `<p class="imdb-pg-no-data">No parental guide information available for "${escapeHtml(titleName)}".</p>`;
  } else {
    const categories = result.data.parentsGuide;
    if (!Array.isArray(categories) || categories.length === 0) {
      html += `<p class="imdb-pg-no-data">No parental guide categories available.</p>`;
    } else {
      categories.forEach((cat, i) => {
        const categoryNameMap = {
          'SEXUAL_CONTENT': 'Sex & Nudity',
          'VIOLENCE': 'Violence & Gore',
          'PROFANITY': 'Profanity',
          'ALCOHOL_DRUGS': 'Alcohol, Drugs & Smoking',
          'FRIGHTENING_INTENSE_SCENES': 'Frightening & Intense Scenes'
        };

        const displayName = categoryNameMap[cat.category] || cat.category;
        const reviews = Array.isArray(cat.reviews) ? cat.reviews : [];
        const severities = Array.isArray(cat.severityBreakdowns) ? cat.severityBreakdowns : [];

        // Calculate most voted severity
        const topSeverity = severities.reduce((max, s) => (s.voteCount > (max.voteCount || 0) ? s : max), {}).severityLevel || 'Unknown';

        html += `
          <div class="imdb-pg-category">
            <button class="imdb-pg-accordion" data-index="${i}">
              <span>${escapeHtml(displayName)}</span>
              <span class="imdb-pg-severity">${escapeHtml(topSeverity)}</span>
            </button>
            <div class="imdb-pg-panel">
              <div class="imdb-pg-severity-table">
                ${severities.map(s => `
                  <div class="imdb-pg-severity-item">
                    <span class="level">${escapeHtml(s.severityLevel)}</span>
                    <span class="votes">${escapeHtml(s.voteCount)} votes</span>
                  </div>
                `).join('')}
              </div>
              ${reviews.length > 0 ? `
                <ul class="imdb-pg-reviews">
                  ${reviews.map(r => `
                    <li>
                      ${r.isSpoiler ? '<span class="spoiler">[Spoiler]</span> ' : ''}
                      ${escapeHtml(r.text || JSON.stringify(r))}
                    </li>
                  `).join('')}
                </ul>
              ` : `<p class="imdb-pg-no-reviews">No user reviews available.</p>`}
            </div>
          </div>
        `;
      });
    }
  }

  html += `
    </div>
    <div class="imdb-pg-footer">
      <span>Data from IMDb via api.imdbapi.dev${result.cached ? ' (cached)' : ''}</span>
    </div>
  `;

  overlayEl.innerHTML = html;

  // Append to Netflix UI
  const insertionPoint = document.querySelector('.previewModal--detailsMetadata-left, .previewModal--container, .title-info-metadata-wrapper, body');
  if (insertionPoint) insertionPoint.appendChild(overlayEl);

  // Close button handler
  overlayEl.querySelector('.imdb-pg-close').addEventListener('click', removeOverlay);

  // Accordion toggles
  overlayEl.querySelectorAll('.imdb-pg-accordion').forEach(button => {
    button.addEventListener('click', () => {
      const panel = button.nextElementSibling;
      const expanded = button.classList.toggle('active');
      panel.style.display = expanded ? 'block' : 'none';
    });
  });

  console.log('[IMDb PG] Overlay created.');
}




  async function processTitle() {
    if (isProcessing) return;
    isProcessing = true;

    try {
      const netflixId = getNetflixTitleId();
      if (!netflixId) {
        log('No Netflix ID found');
        return;
      }

      if (netflixId === currentNetflixId) {
        log('Same title already processed');
        return;
      }

      currentNetflixId = netflixId;
      const { titleName, year } = extractTitleInfo();
      if (!titleName) {
        log('No title name found, retrying...');
        setTimeout(processTitle, 2000);
        return;
      }

      log(`Fetching parental guide for "${titleName}" (${year || 'unknown'})`);
      const result = await fetchParentalGuideFromBackground(netflixId, titleName, year);
      createOverlay(result, titleName);
    } catch (err) {
      console.error('[IMDb PG] processTitle error:', err);
    } finally {
      isProcessing = false;
    }
  }

  const debouncedProcessTitle = (() => {
    let timeout;
    return () => {
      clearTimeout(timeout);
      timeout = setTimeout(processTitle, 1000);
    };
  })();

  function init() {
    console.log('%c[IMDb PG] 🚀 init() called', 'color: cyan; font-weight: bold;');
    setTimeout(processTitle, 2000);

    let lastUrl = window.location.href;
    new MutationObserver(() => {
      const url = window.location.href;
      if (url !== lastUrl) {
        log('URL changed → reprocessing');
        lastUrl = url;
        currentNetflixId = null;
        removeOverlay();
        debouncedProcessTitle();
      }
    }).observe(document, { subtree: true, childList: true });

    window.addEventListener('popstate', () => {
      log('Popstate detected');
      debouncedProcessTitle();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  console.log('%c[IMDb PG] Content script loaded successfully', 'color: lime; font-weight: bold;');
})();
