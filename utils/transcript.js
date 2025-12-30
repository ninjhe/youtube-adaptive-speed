/**
 * Transcript Fetching Module
 * Uses YouTube's Innertube API to reliably fetch transcripts
 */

const TranscriptFetcher = {

    // Innertube API configuration
    INNERTUBE_API_KEY: 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',  // Public key used by YouTube

    /**
     * Fetches transcript for the current video
     * @returns {Promise<Array<{text: string, start: number, duration: number}>>}
     */
    async fetchTranscript() {
        try {
            const videoId = this.getVideoId();
            if (!videoId) {
                AdaptiveSpeedDebug.log('No video ID found');
                return null;
            }

            AdaptiveSpeedDebug.log('Fetching transcript for video:', videoId);

            // Method 1: Try Innertube API (most reliable)
            const transcript = await this.fetchViaInnertube(videoId);
            if (transcript && transcript.length > 0) {
                return transcript;
            }

            // Method 2: Try extracting from page's ytInitialPlayerResponse
            const pageTranscript = await this.fetchFromPageData(videoId);
            if (pageTranscript && pageTranscript.length > 0) {
                return pageTranscript;
            }

            AdaptiveSpeedDebug.log('No transcript available');
            return null;
        } catch (error) {
            console.error('[AdaptiveSpeed] Error fetching transcript:', error);
            return null;
        }
    },

    /**
     * Gets the video ID from the current URL
     */
    getVideoId() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get('v');
    },

    /**
     * Fetches transcript using YouTube's Innertube API
     * Uses ANDROID client context which has fewer restrictions
     */
    async fetchViaInnertube(videoId) {
        try {
            AdaptiveSpeedDebug.log('Trying Innertube API...');

            // First, get player response to find caption tracks
            const playerResponse = await this.getInnertubePlayerResponse(videoId);
            if (!playerResponse) {
                AdaptiveSpeedDebug.log('No player response from Innertube');
                return null;
            }

            const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
            if (!captionTracks || captionTracks.length === 0) {
                AdaptiveSpeedDebug.log('No caption tracks in Innertube response');
                return null;
            }

            // Select best track (prefer manual, prefer English)
            const track = this.selectBestTrack(captionTracks);
            if (!track) {
                AdaptiveSpeedDebug.log('No suitable caption track');
                return null;
            }

            AdaptiveSpeedDebug.log('Using caption track:', track.name?.simpleText || track.languageCode);

            // Fetch the actual transcript XML
            const transcriptUrl = track.baseUrl;
            AdaptiveSpeedDebug.log('Fetching transcript XML from:', transcriptUrl.substring(0, 100) + '...');

            const response = await fetch(transcriptUrl);
            if (!response.ok) {
                AdaptiveSpeedDebug.log('Transcript fetch failed:', response.status);
                return null;
            }

            const xmlText = await response.text();
            AdaptiveSpeedDebug.log('XML response length:', xmlText.length);
            AdaptiveSpeedDebug.log('XML preview:', xmlText.substring(0, 500));

            if (!xmlText || xmlText.trim() === '') {
                AdaptiveSpeedDebug.log('Empty transcript response');
                return null;
            }

            // Parse XML transcript
            return this.parseTranscriptXML(xmlText);
        } catch (error) {
            console.error('[AdaptiveSpeed] Innertube fetch error:', error);
            return null;
        }
    },

    /**
     * Gets player response from Innertube API
     */
    async getInnertubePlayerResponse(videoId) {
        const endpoint = 'https://www.youtube.com/youtubei/v1/player?key=' + this.INNERTUBE_API_KEY;

        const body = {
            context: {
                client: {
                    hl: 'en',
                    gl: 'US',
                    clientName: 'ANDROID',
                    clientVersion: '19.09.37',
                    androidSdkVersion: 30,
                    userAgent: 'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip'
                }
            },
            videoId: videoId,
            playbackContext: {
                contentPlaybackContext: {
                    signatureTimestamp: this.getSignatureTimestamp()
                }
            },
            racyCheckOk: true,
            contentCheckOk: true
        };

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-YouTube-Client-Name': '3',
                    'X-YouTube-Client-Version': '19.09.37'
                },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                AdaptiveSpeedDebug.log('Innertube player request failed:', response.status);
                return null;
            }

            const data = await response.json();
            return data;
        } catch (error) {
            console.error('[AdaptiveSpeed] Innertube player request error:', error);
            return null;
        }
    },

    /**
     * Gets signature timestamp from the page (for playback context)
     */
    getSignatureTimestamp() {
        // Try to extract from ytInitialPlayerResponse
        try {
            const scripts = document.querySelectorAll('script');
            for (const script of scripts) {
                const text = script.textContent;
                if (text && text.includes('signatureTimestamp')) {
                    const match = text.match(/"signatureTimestamp":(\d+)/);
                    if (match) {
                        return parseInt(match[1]);
                    }
                }
            }
        } catch (e) {
            // Ignore
        }
        // Default fallback
        return 19950;
    },

    /**
     * Fallback: Try to fetch transcript from page's embedded data
     */
    async fetchFromPageData(videoId) {
        try {
            AdaptiveSpeedDebug.log('Trying page data extraction...');

            const scripts = document.querySelectorAll('script');
            for (const script of scripts) {
                const text = script.textContent;
                if (text && text.includes('ytInitialPlayerResponse')) {
                    const match = text.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);
                    if (match) {
                        const playerResponse = JSON.parse(match[1]);
                        const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

                        if (captionTracks && captionTracks.length > 0) {
                            const track = this.selectBestTrack(captionTracks);
                            if (track) {
                                AdaptiveSpeedDebug.log('Found track in page data:', track.name?.simpleText);

                                // Try fetching with the baseUrl from page data
                                const response = await fetch(track.baseUrl);
                                if (response.ok) {
                                    const xmlText = await response.text();
                                    if (xmlText && xmlText.trim() !== '') {
                                        return this.parseTranscriptXML(xmlText);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } catch (error) {
            console.error('[AdaptiveSpeed] Page data extraction error:', error);
        }
        return null;
    },

    /**
     * Selects the best caption track
     * Priority:
     * 1. Auto-generated (ASR) - most reliable for speech timing
     * 2. Space-separated languages (not logographic) - for accurate WPS
     * 3. Tracks with translation capability (usually official)
     * 4. English preferred, then other Latin/Romance languages
     */
    selectBestTrack(tracks) {
        // Languages that use spaces between words (good for WPS calculation)
        const PREFERRED_LANGUAGES = ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'ru', 'sv', 'no', 'da', 'fi'];

        // Logographic/compact languages (bad for WPS - characters ≠ words)
        const AVOID_LANGUAGES = ['zh', 'ja', 'ko', 'th', 'ar', 'he'];

        const sorted = [...tracks].sort((a, b) => {
            // Prefer ASR (auto-generated) - most reliable timing for speech
            const aIsAsr = a.kind === 'asr';
            const bIsAsr = b.kind === 'asr';

            // Avoid logographic languages
            const aLang = a.languageCode?.split('-')[0] || '';
            const bLang = b.languageCode?.split('-')[0] || '';
            const aAvoid = AVOID_LANGUAGES.includes(aLang);
            const bAvoid = AVOID_LANGUAGES.includes(bLang);

            // Prefer space-separated languages
            const aPreferred = PREFERRED_LANGUAGES.includes(aLang);
            const bPreferred = PREFERRED_LANGUAGES.includes(bLang);

            // Prefer English specifically
            const aEnglish = aLang === 'en';
            const bEnglish = bLang === 'en';

            // Prefer tracks with translation capability (indicates official)
            const aIsTranslatable = a.isTranslatable === true;
            const bIsTranslatable = b.isTranslatable === true;

            // Sorting priority:
            // 1. ASR first
            if (aIsAsr !== bIsAsr) return aIsAsr ? -1 : 1;
            // 2. Avoid logographic languages
            if (aAvoid !== bAvoid) return aAvoid ? 1 : -1;
            // 3. Prefer good languages
            if (aPreferred !== bPreferred) return aPreferred ? -1 : 1;
            // 4. Prefer English
            if (aEnglish !== bEnglish) return aEnglish ? -1 : 1;
            // 5. Prefer translatable
            if (aIsTranslatable !== bIsTranslatable) return aIsTranslatable ? -1 : 1;
            return 0;
        });

        const selected = sorted[0];

        // If only logographic languages available, treat as no transcript
        if (selected) {
            const selectedLang = selected.languageCode?.split('-')[0] || '';
            if (AVOID_LANGUAGES.includes(selectedLang)) {
                AdaptiveSpeedDebug.log('Only logographic languages available (' + selected.languageCode + '), skipping transcript');
                return null;
            }

            AdaptiveSpeedDebug.log('Selected track:',
                selected.kind === 'asr' ? 'Auto-generated' : 'Manual',
                selected.languageCode,
                selected.isTranslatable ? '(translatable)' : '');
        }

        return selected;
    },

    /**
     * Parses YouTube's transcript XML format into segments
     * YouTube uses <p> for paragraphs with t (start time in ms) and d (duration in ms)
     * Each <p> contains <s> segments with the actual text
     */
    parseTranscriptXML(xmlText) {
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(xmlText, 'text/xml');

            // Check for parsing errors
            const parseError = doc.querySelector('parsererror');
            if (parseError) {
                console.error('[AdaptiveSpeed] XML parse error:', parseError.textContent);
                return null;
            }

            const segments = [];

            // YouTube format uses <p> elements for paragraphs
            const paragraphs = doc.querySelectorAll('p');

            if (paragraphs.length > 0) {
                AdaptiveSpeedDebug.log('Found', paragraphs.length, 'paragraph elements');

                for (const p of paragraphs) {
                    // Skip placeholder/continuation paragraphs (often have a="1" and no real text)
                    if (p.getAttribute('a') === '1') {
                        continue;
                    }

                    // Get all text from the paragraph (combines all <s> elements)
                    const text = p.textContent?.trim();
                    if (!text) continue;

                    // Time is in milliseconds, convert to seconds
                    const startMs = parseInt(p.getAttribute('t') || '0');
                    const durationMs = parseInt(p.getAttribute('d') || '0');

                    // Skip segments with no duration
                    if (durationMs <= 0) continue;

                    // Decode HTML entities
                    const decoded = text
                        .replace(/&amp;/g, '&')
                        .replace(/&lt;/g, '<')
                        .replace(/&gt;/g, '>')
                        .replace(/&quot;/g, '"')
                        .replace(/&#39;/g, "'")
                        .replace(/\n/g, ' ')
                        .trim();

                    if (decoded) {
                        segments.push({
                            text: decoded,
                            start: startMs / 1000,  // Convert ms to seconds
                            duration: durationMs / 1000
                        });
                    }
                }
            }

            // Fallback: try <text> elements (older format)
            if (segments.length === 0) {
                const textElements = doc.querySelectorAll('text');
                AdaptiveSpeedDebug.log('Trying text elements, found:', textElements.length);

                for (const element of textElements) {
                    const text = element.textContent?.trim();
                    if (!text) continue;

                    const decoded = text
                        .replace(/&amp;/g, '&')
                        .replace(/&lt;/g, '<')
                        .replace(/&gt;/g, '>')
                        .replace(/&quot;/g, '"')
                        .replace(/&#39;/g, "'")
                        .replace(/\n/g, ' ');

                    segments.push({
                        text: decoded,
                        start: parseFloat(element.getAttribute('start') || '0'),
                        duration: parseFloat(element.getAttribute('dur') || '0')
                    });
                }
            }

            AdaptiveSpeedDebug.log(`Parsed ${segments.length} transcript segments from XML`);
            return segments.length > 0 ? segments : null;
        } catch (error) {
            console.error('[AdaptiveSpeed] XML parsing error:', error);
            return null;
        }
    },

    /**
     * Parses YouTube's json3 transcript format into segments (fallback)
     */
    parseTranscriptData(data) {
        const events = data.events || [];
        const segments = [];

        for (const event of events) {
            if (!event.segs) continue;

            const text = event.segs.map(seg => seg.utf8).join('').trim();
            if (!text) continue;

            segments.push({
                text: text,
                start: event.tStartMs / 1000,
                duration: (event.dDurationMs || 0) / 1000
            });
        }

        AdaptiveSpeedDebug.log(`Parsed ${segments.length} transcript segments from JSON`);
        return segments;
    }
};

// Make available globally for content script
window.TranscriptFetcher = TranscriptFetcher;
